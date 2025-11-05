import boto3
import json
import logging
from decimal import Decimal

# --- Configuration ---
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
suppliersPath = '/suppliers'

# --- Custom Encoder for DynamoDB's Decimal type (Essential) ---
class CustomEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return json.JSONEncoder.default(self, obj)


# ----------------------------------------------------------------------
#                             MAIN HANDLER
# ----------------------------------------------------------------------

def lambda_handler(event, context):
    logger.info(event)
    httpMethod = event['httpMethod']
    path = event['path']
    
    # --- Routing Logic with Composite Key Handling ---
    
    if httpMethod == getMethod and path == healthPath:
        response = buildResponse(200)
        
    # READ (Individual Item) - Assuming both keys in query string for now
    elif httpMethod == getMethod and path == supplierPath:
        # **CORRECTION**: Pass BOTH keys from query string
        params = event.get('queryStringParameters', {})
        pk = params.get('SAP vendor code')
        sk = params.get('Plant Code')
        response = getSupplier(pk, sk)
        
    # LIST ALL (Scan)
    elif httpMethod == getMethod and path == suppliersPath:
        response = getSuppliers()
        
    # CREATE
    elif httpMethod == postMethod and path == supplierPath:
        response = saveSupplier(json.loads(event.get('body', '{}')))
        
    # UPDATE
    elif httpMethod == patchMethod and path == supplierPath:
        requestBody = json.loads(event.get('body', '{}'))
        # **CORRECTION**: Pass BOTH keys from the request body
        pk = requestBody.get('SAP vendor code')
        sk = requestBody.get('Plant Code')
        response = modifySupplier(pk, sk, requestBody.get('updateKey'), requestBody.get('updateValue'))
        
    # DELETE
    elif httpMethod == deleteMethod and path == supplierPath:
        requestBody = json.loads(event.get('body', '{}'))
        # **CORRECTION**: Pass BOTH keys from the request body
        pk = requestBody.get('SAP vendor code')
        sk = requestBody.get('Plant Code')
        response = deleteSupplier(pk, sk)
        
    else:
        response = buildResponse(404,'Not Found')
        
    return response

# ----------------------------------------------------------------------
#                             CRUD FUNCTIONS
# ----------------------------------------------------------------------

# **CORRECTION**: Function accepts BOTH keys (pk, sk)
def getSupplier(pk, sk):
    try:
        if not pk or not sk:
            return buildResponse(400, 'Missing SAP vendor code or Plant Code.')
            
        # **CORRECTION**: Use string literal for attribute name, variable for value. Use BOTH keys.
        response = table.get_item(Key={'SAP vendor code': pk, 'Plant Code': sk}) 
        
        if 'Item' in response:
            return buildResponse(200,response['Item'])
        else:
            return buildResponse(404,f'Supplier with ID {pk} and Plant {sk} not found')
            
    except Exception as e:
        logger.error('Error getting supplier: %s', e)
        return buildResponse(500,f'Error getting supplier: {str(e)}')


def getSuppliers():
    # ... (Scan logic remains the same) ...
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
        return buildResponse(500,f'Error getting suppliers: {str(e)}')


def saveSupplier(requestBody):
    try:
        # **CORRECTION**: Enforce that both PK and SK are present
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
        return buildResponse(500,f'Error saving supplier: {error}')


# **CORRECTION**: Function accepts BOTH keys (pk, sk)
def modifySupplier(pk, sk, updateKey, updateValue):
    try:
        if not pk or not sk:
            return buildResponse(400, 'Missing SAP vendor code or Plant Code.')
            
        # 1. Define placeholders for the attribute name and value
        attribute_placeholder = "#UKey"
        value_placeholder = ":val"

        # 2. Use the placeholder in the UpdateExpression
        update_expression = f"SET {attribute_placeholder} = {value_placeholder}"

        # 3. Map the placeholder to the actual attribute name (which has a space)
        expression_attribute_names = {
            attribute_placeholder: updateKey  # e.g., "#UKey": "Vendor Name"
        }

        # 4. Map the value placeholder to the actual value
        expression_attribute_values = {
            value_placeholder: updateValue    # e.g., ":val": "New Name"
        }

        # Use BOTH keys in the Key dictionary and pass the new expression maps
        response = table.update_item(
            Key={'SAP vendor code': pk, 'Plant Code': sk},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names, # <-- CRITICAL ADDITION
            ExpressionAttributeValues=expression_attribute_values,
            ReturnValues='UPDATED_NEW')
            
        body = {
            'Operation': 'UPDATE',
            'Message': 'SUCCESS',
            'UpdatedAttributes': response['Attributes']
        }
        return buildResponse(200,body)
            
    except Exception as e:
        logger.error('Error modifying supplier: %s', e)
        return buildResponse(500,f'Error modifying supplier: {str(e)}')


# **CORRECTION**: Function accepts BOTH keys (pk, sk)
def deleteSupplier(pk, sk):
    try:
        if not pk or not sk:
            return buildResponse(400, 'Missing SAP vendor code or Plant Code.')
            
        # **CORRECTION**: Use BOTH keys in the Key dictionary
        response = table.delete_item(Key={'SAP vendor code': pk, 'Plant Code': sk}, ReturnValues='ALL_OLD')
        
        body = {
            'Operation': 'DELETE',
            'Message': 'SUCCESS',
            'DeletedItem': response.get('Attributes')
        }
        return buildResponse(200,body) 
        
    except Exception as e:
        logger.error('Error deleting supplier: %s', e)
        return buildResponse(500,f'Error deleting supplier: {str(e)}')


def buildResponse(statusCode, body=None):
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