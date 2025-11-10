import boto3
import json
import logging
import base64
import csv
import io
from decimal import Decimal

# --- Configuration & Initialization ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodbTableName = "VendorUserPoCTable"
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(dynamodbTableName)

# --- Constants (UPDATED) ---
getMethod = 'GET'
postMethod = 'POST'
patchMethod = 'PATCH'
deleteMethod = 'DELETE'
healthPath = '/health'
supplierPath = '/supplier'
suppliersPath = '/suppliers' 
# NEW CONSTANTS FOR DOWNLOAD API
downloadAllPath = '/suppliers/download/all'
downloadFilteredPath = '/suppliers/download/filtered'

# --- Custom Encoder for DynamoDB's Decimal type (Essential) ---
class CustomEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Convert Decimal to string for JSON serialization
            return str(obj)
        return json.JSONEncoder.default(self, obj)


# ----------------------------------------------------------------------
#                             MAIN HANDLER (UPDATED)
# ----------------------------------------------------------------------

def lambda_handler(event, context):
    """
    Main Lambda entry point to route requests.
    """
    logger.info(event)
    httpMethod = event.get('httpMethod')
    # API Gateway typically normalizes the path, but we'll use a simple check here
    path = event.get('path')
    
    if httpMethod == getMethod and path == healthPath:
        response = buildResponse(200, {'status': 'OK'})
        
    elif httpMethod == getMethod and path == supplierPath:
        # READ Individual Item: GET /supplier?SAP vendor code=...&Plant Code=...
        params = event.get('queryStringParameters', {})
        pk = params.get('SAP vendor code')
        sk = params.get('Plant Code')
        response = getSupplier(pk, sk)
        
    elif httpMethod == getMethod and path == suppliersPath:
        # LIST ALL: GET /suppliers (Returns JSON)
        response = getSuppliers()
    
    # --- NEW DOWNLOAD API ROUTES ---
    elif httpMethod == getMethod and path == downloadAllPath:
        # DOWNLOAD ALL: GET /suppliers/download/all
        logger.info("Routing GET to download all records.")
        response = downloadRecords(None)
        
    elif httpMethod == getMethod and path == downloadFilteredPath:
        # DOWNLOAD FILTERED: GET /suppliers/download/filtered?Key=Value&Key2=Value2
        logger.info("Routing GET to download filtered records.")
        params = event.get('queryStringParameters', {})
        response = downloadRecords(params)
    # --- END NEW DOWNLOAD ROUTES ---
    
    elif httpMethod == postMethod and path == supplierPath:
        # CREATE (Single JSON record)
        response = saveSupplier(json.loads(event.get('body', '{}')))
        
    elif httpMethod == postMethod and path == suppliersPath:
        # POST /suppliers: Routes based on payload type (File or JSON)
        if event.get('isBase64Encoded'):
            logger.info("Routing POST /suppliers to file upload handler.")
            response = processFileUpload(event)
        else:
            logger.info("Routing POST /suppliers to single record save handler.")
            try:
                request_body = json.loads(event.get('body', '{}'))
            except json.JSONDecodeError:
                return buildResponse(400, {'message': 'Invalid JSON body for single record POST.'})
            response = saveSupplier(request_body)

    elif httpMethod == patchMethod and path == supplierPath:
        # UPDATE: PATCH /supplier (supports single or multiple attribute updates)
        requestBody = json.loads(event.get('body', '{}'))
        pk = requestBody.get('SAP vendor code')
        sk = requestBody.get('Plant Code')
        # Backward compatibility: updateKey/updateValue
        updates = {}
        if isinstance(requestBody.get('updates'), dict) and requestBody.get('updates'):
            updates = requestBody.get('updates')
        elif 'updateKey' in requestBody:
            updates = {requestBody.get('updateKey'): requestBody.get('updateValue')}
        else:
            # Treat any non-key fields in body as updates
            for k, v in requestBody.items():
                if k in ('SAP vendor code', 'Plant Code', 'updateKey', 'updateValue'):
                    continue
                updates[k] = v
        response = modifySupplier(pk, sk, updates)
        
    elif httpMethod == deleteMethod and path == supplierPath:
        # DELETE: DELETE /supplier
        requestBody = json.loads(event.get('body', '{}'))
        pk = requestBody.get('SAP vendor code')
        sk = requestBody.get('Plant Code')
        response = deleteSupplier(pk, sk)
        
    else:
        response = buildResponse(404, {'message': 'Not Found'})
        
    return response

# ----------------------------------------------------------------------
#                         FILE PROCESSING FUNCTIONS (UNCHANGED)
# ----------------------------------------------------------------------

# ... (processFileUpload, parse_csv, and batch_insert_dynamodb functions remain the same) ...

def processFileUpload(event):
    """Handles the file upload, decoding, parsing, and batch insertion."""
    try:
        encoded_data = event.get('body')
        
        # 1. Decode Base64 content
        if not encoded_data:
             return buildResponse(400, {'message': 'File content is missing or not correctly Base64 encoded.'})

        file_content_bytes = base64.b64decode(encoded_data)
        
        # 2. Parse the CSV data
        file_content_stream = io.StringIO(file_content_bytes.decode('utf-8'))
        records_to_insert = parse_csv(file_content_stream)
        
        if not records_to_insert:
            return buildResponse(400, {'message': 'No valid records found in the file after parsing. Check headers and key fields.'})
        
        # 3. Batch insert into DynamoDB
        total_inserted = batch_insert_dynamodb(records_to_insert)
        
        body = {
            'Operation': 'BATCH_UPLOAD',
            'Message': f'Successfully initiated insertion for {total_inserted} records.',
            'TotalRecordsProcessed': len(records_to_insert),
            'TotalRecordsInserted': total_inserted
        }
        return buildResponse(201, body)

    except Exception as e:
        logger.error('Error processing file upload: %s', e)
        return buildResponse(500,{'error': f'Internal Server Error during file processing: {str(e)}. Make sure file is small and correctly formatted.'})

def parse_csv(file_stream):
    """
    Parses a CSV file stream into a list of dictionaries.
    Explicitly forces key values to be strings and converts other numeric fields to Decimal.
    """
    csv_reader = csv.DictReader(file_stream)
    records = []
    
    pk_key = 'SAP vendor code'
    sk_key = 'Plant Code'
    
    for row in csv_reader:
        processed_row = {}
        
        pk_val = row.get(pk_key)
        sk_val = row.get(sk_key)
        
        # 1. Validation & Explicit String Conversion for Keys (FIX)
        if not pk_val or not sk_val:
             logger.warning(f"Skipping row: Missing required keys.")
             continue
        
        # *** FIX 1: Force the key values to be String type (S) to match DDB schema ***
        processed_row[pk_key] = str(pk_val).strip()
        processed_row[sk_key] = str(sk_val).strip()

        # 2. Process all other attributes
        for key, value in row.items():
            
            # *** FIX 2: Skip key attributes here as they were already processed/forced to string ***
            if key == pk_key or key == sk_key:
                continue 
                
            cleaned_value = value.strip() if isinstance(value, str) else value

            if isinstance(cleaned_value, str):
                # Attempt to convert other numeric fields to Decimal (N)
                if cleaned_value.replace('.', '', 1).isdigit() and cleaned_value != '':
                    try:
                        processed_row[key] = Decimal(cleaned_value)
                    except:
                        # Fallback if Decimal conversion fails for a valid reason
                        processed_row[key] = cleaned_value
                elif cleaned_value == '':
                    # DynamoDB doesn't allow empty strings; skip attribute
                    continue 
                else:
                    processed_row[key] = cleaned_value
            else:
                processed_row[key] = cleaned_value
                
        records.append(processed_row)
             
    return records

def batch_insert_dynamodb(records):
    """
    Uses the Boto3 DynamoDB Resource batch_writer for efficient, reliable insertion.
    It automatically handles batching and retrying unprocessed items.
    """
    inserted_count = 0
    
    # Use the table resource's batch_writer for auto-handling of batching and retries
    with table.batch_writer() as batch:
        for item in records:
            try:
                batch.put_item(Item=item)
                inserted_count += 1
            except Exception as e:
                # This catches errors preventing the item from being sent to the batch buffer
                logger.error(f"Error preparing item for batch write: {e}. Item: {item}")
                
    # The count reflects successful calls to put_item in the batcher
    return inserted_count


# ----------------------------------------------------------------------
#                         NEW DOWNLOAD FUNCTIONS (ADDED)
# ----------------------------------------------------------------------

def downloadRecords(filter_params):
    """
    Handles fetching records (all or filtered) and returns a CSV response.
    :param filter_params: A dict of query string parameters for filtering. None for all records.
    """
    try:
        all_items = []
        scan_kwargs = {}
        
        if filter_params:
            # Prepare Scan arguments for filtering
            filter_expression = ""
            expression_attribute_names = {}
            expression_attribute_values = {}
            
            # Build FilterExpression from query parameters
            for i, (key, value) in enumerate(filter_params.items()):
                # Use placeholder names for attributes that might be DynamoDB reserved words
                attr_name_placeholder = f"#attrName{i}"
                attr_value_placeholder = f":attrVal{i}"
                
                if filter_expression:
                    filter_expression += " AND "
                filter_expression += f"{attr_name_placeholder} = {attr_value_placeholder}"
                
                expression_attribute_names[attr_name_placeholder] = key
                expression_attribute_values[attr_value_placeholder] = value
            
            scan_kwargs['FilterExpression'] = filter_expression
            scan_kwargs['ExpressionAttributeNames'] = expression_attribute_names
            scan_kwargs['ExpressionAttributeValues'] = expression_attribute_values
            logger.info(f"Using filter: {filter_expression}")

        # Fetch data with pagination (Scan is used for simplicity/non-key filtering)
        response = table.scan(**scan_kwargs)
        all_items.extend(response.get('Items', []))
        
        while 'LastEvaluatedKey' in response:
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = table.scan(**scan_kwargs)
            all_items.extend(response.get('Items', []))

        if not all_items:
            return buildResponse(204, {'message': 'No records found for download.'})

        # Convert data to CSV format
        csv_data = convert_to_csv(all_items)

        # Create the Base64-encoded response for API Gateway
        return buildCsvResponse(csv_data)

    except Exception as e:
        logger.error('Error during download: %s', e)
        return buildResponse(500, {'error': f'Internal Server Error during download: {str(e)}'})

def convert_to_csv(items):
    """Converts a list of DynamoDB items (dictionaries) into a CSV string."""
    if not items:
        return ""
    
    # 1. Collect all unique column headers from all items
    headers = set()
    for item in items:
        headers.update(item.keys())
    # Convert set to list (sorted for consistent column order)
    header_list = sorted(list(headers))
    
    # 2. Write to CSV
    output = io.StringIO()
    # DictWriter maps dictionary keys to fieldnames/headers
    writer = csv.DictWriter(output, fieldnames=header_list, extrasaction='ignore', dialect='excel')
    
    writer.writeheader()
    for item in items:
        # Convert Decimal values to string before writing
        cleaned_item = {k: str(v) if isinstance(v, Decimal) else v for k, v in item.items()}
        writer.writerow(cleaned_item)
        
    return output.getvalue()
    
def buildCsvResponse(csv_data):
    """
    Builds the API Gateway response for a binary (CSV) file download.
    CRITICAL: isBase64Encoded must be True and Content-Type must be set to text/csv.
    """
    # 1. Base64 encode the CSV string
    # .encode('utf-8') converts string to bytes, b64encode encodes bytes, .decode('utf-8') converts back to string
    encoded_csv = base64.b64encode(csv_data.encode('utf-8')).decode('utf-8')
    
    # 2. Configure the headers for file download
    response = {
        'statusCode': 200,
        'isBase64Encoded': True, 
        'headers': {
            'Content-Type': 'text/csv',
            # Forces the browser to download the file and suggests a filename
            'Content-Disposition': 'attachment; filename="suppliers_export.csv"', 
            'Access-Control-Allow-Origin': '*',
        },
        'body': encoded_csv
    }
    return response

# ----------------------------------------------------------------------
#                         EXISTING CRUD FUNCTIONS (UNCHANGED)
# ----------------------------------------------------------------------
# ... (getSupplier, getSuppliers, saveSupplier, modifySupplier, deleteSupplier, buildResponse functions remain the same) ...

def getSupplier(pk, sk):
    # ... (Your original getSupplier logic)
    try:
        if not pk or not sk:
            return buildResponse(400, {'message': 'Missing SAP vendor code or Plant Code.'})
            
        response = table.get_item(Key={'SAP vendor code': pk, 'Plant Code': sk}) 
        
        if 'Item' in response:
            return buildResponse(200,response['Item'])
        else:
            return buildResponse(404,{'message': f'Supplier with ID {pk} and Plant {sk} not found'})
            
    except Exception as e:
        logger.error('Error getting supplier: %s', e)
        return buildResponse(500,{'error': f'Error getting supplier: {str(e)}'})

def getSuppliers():
    # ... (Your original getSuppliers logic)
    try:
        response = table.scan()
        result = response['Items']
        while 'LastEvaluatedKey' in response:
            response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            result.extend(response['Items'])
        
        body = {'suppliers': result}
        return buildResponse(200,body)
        
    except Exception as e:
        logger.error('Error getting suppliers: %s', e)
        return buildResponse(500,{'error': f'Error getting suppliers: {str(e)}'})

def saveSupplier(requestBody):
    # ... (Your original saveSupplier logic)
    try:
        if 'SAP vendor code' not in requestBody or 'Plant Code' not in requestBody:
            return buildResponse(400, {'message': 'Missing required primary keys for SAVE.'})
            
        table.put_item(Item=requestBody)
        
        body = {
            'Operation': 'SAVE',
            'Message': 'SUCCESS',
            'ItemKey': requestBody['SAP vendor code']
        }
        return buildResponse(201, body)
        
    except Exception as error:
        logger.error('Error saving supplier: %s', error)
        return buildResponse(500,{'error': f'Error saving supplier: {error}'})

def modifySupplier(pk, sk, updates):
    # Multi-field update support; accepts a dict of attribute name -> value
    try:
        if not pk or not sk:
            return buildResponse(400, {'message': 'Missing SAP vendor code or Plant Code.'})
        if not isinstance(updates, dict) or len(updates) == 0:
            return buildResponse(400, {'message': 'No attributes provided to update.'})

        set_clauses = []
        expression_attribute_names = {}
        expression_attribute_values = {}

        i = 0
        for attr, value in updates.items():
            name_ph = f"#U{i}"
            value_ph = f":v{i}"
            set_clauses.append(f"{name_ph} = {value_ph}")
            expression_attribute_names[name_ph] = attr
            expression_attribute_values[value_ph] = value
            i += 1

        update_expression = "SET " + ", ".join(set_clauses)

        response = table.update_item(
            Key={'SAP vendor code': pk, 'Plant Code': sk},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values,
            ReturnValues='UPDATED_NEW')
            
        body = {
            'Operation': 'UPDATE',
            'Message': 'SUCCESS',
            'UpdatedAttributes': response.get('Attributes')
        }
        return buildResponse(200,body)
            
    except Exception as e:
        logger.error('Error modifying supplier: %s', e)
        return buildResponse(500,{'error': f'Error modifying supplier: {str(e)}'})

def deleteSupplier(pk, sk):
    # ... (Your original deleteSupplier logic)
    try:
        if not pk or not sk:
            return buildResponse(400, {'message': 'Missing SAP vendor code or Plant Code.'})
            
        response = table.delete_item(Key={'SAP vendor code': pk, 'Plant Code': sk}, ReturnValues='ALL_OLD')
        
        body = {
            'Operation': 'DELETE',
            'Message': 'SUCCESS',
            'DeletedItem': response.get('Attributes')
        }
        return buildResponse(200,body) 
        
    except Exception as e:
        logger.error('Error deleting supplier: %s', e)
        return buildResponse(500,{'error': f'Error deleting supplier: {str(e)}'})

def buildResponse(statusCode, body=None):
    # ... (Your original buildResponse logic)
    response = {
        'statusCode': statusCode,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        }
    }
    if body is not None:
        response['body'] = json.dumps(body,cls=CustomEncoder)
    return response

# ----------------------------------------------------------------------