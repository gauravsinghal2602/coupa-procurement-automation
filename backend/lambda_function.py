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

# --- Constants ---
getMethod = 'GET'
postMethod = 'POST'
patchMethod = 'PATCH'
deleteMethod = 'DELETE'
healthPath = '/health'
supplierPath = '/supplier'
suppliersPath = '/suppliers' # Reusing this path for file upload

# --- Custom Encoder for DynamoDB's Decimal type (Essential) ---
class CustomEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Convert Decimal to string for JSON serialization
            return str(obj)
        return json.JSONEncoder.default(self, obj)


# ----------------------------------------------------------------------
#                             MAIN HANDLER
# ----------------------------------------------------------------------

def lambda_handler(event, context):
    """
    Main Lambda entry point to route requests.
    POST /suppliers now routes based on payload type (File or JSON).
    """
    logger.info(event)
    httpMethod = event.get('httpMethod')
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
        # LIST ALL: GET /suppliers
        response = getSuppliers()
        
    elif httpMethod == postMethod and path == suppliersPath:
        # POST /suppliers: Routes based on payload type (File vs. JSON)
        
        # 1. Check if the payload is a Base64-encoded file (API Gateway sets this flag)
        if event.get('isBase64Encoded'):
            logger.info("Routing POST /suppliers to file upload handler.")
            response = processFileUpload(event)
        else:
            # 2. Assume it's a standard single JSON object for saving
            logger.info("Routing POST /suppliers to single record save handler.")
            try:
                request_body = json.loads(event.get('body', '{}'))
            except json.JSONDecodeError:
                return buildResponse(400, {'message': 'Invalid JSON body for single record POST.'})
            response = saveSupplier(request_body)

    elif httpMethod == patchMethod and path == supplierPath:
        # UPDATE: PATCH /supplier
        requestBody = json.loads(event.get('body', '{}'))
        pk = requestBody.get('SAP vendor code')
        sk = requestBody.get('Plant Code')
        response = modifySupplier(pk, sk, requestBody.get('updateKey'), requestBody.get('updateValue'))
        
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
#                         FILE PROCESSING FUNCTIONS (NEW)
# ----------------------------------------------------------------------

def processFileUpload(event):
    """Handles the file upload, decoding, parsing, and batch insertion."""
    try:
        encoded_data = event.get('body')
        
        # 1. Decode Base64 content
        # Check already done in handler, but good practice to ensure data exists
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
#                         EXISTING CRUD FUNCTIONS (UNCHANGED)
# ----------------------------------------------------------------------
# (getSupplier, getSuppliers, saveSupplier, modifySupplier, deleteSupplier, buildResponse functions go here)

# [NOTE: Insert your original CRUD function definitions here to make the file complete]
# ...

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

def modifySupplier(pk, sk, updateKey, updateValue):
    # ... (Your original modifySupplier logic)
    try:
        if not pk or not sk:
            return buildResponse(400, {'message': 'Missing SAP vendor code or Plant Code.'})
            
        attribute_placeholder = "#UKey"
        value_placeholder = ":val"

        update_expression = f"SET {attribute_placeholder} = {value_placeholder}"

        expression_attribute_names = {
            attribute_placeholder: updateKey
        }

        expression_attribute_values = {
            value_placeholder: updateValue
        }

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