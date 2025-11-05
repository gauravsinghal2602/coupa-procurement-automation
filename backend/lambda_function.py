import boto3
import json
from custom_encoder import CustomEncoder
import logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


dynamodbTableName = "VendorUserPoCTable"
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(dynamodbTableName)

getMethod = 'GET'
postMethod = 'POST'
patchMethod = 'PATCH'
deleteMethod = 'DELETE'
healthPath = '/health'
supplierPath = '/supplier'
suppliersPath = '/suppliers'


def lambda_handler(event,context):
    logger.info(event)
    httpMethod = event['httpMethod']
    path = event['path']
    if httpMethod == getMethod and path == healthPath:
        response = buildResponse(200)
    elif httpMethod == getMethod and path == supplierPath:
        response = getSupplier(event['queryStringParameters']['supplierId'])
    elif httpMethod == getMethod and path == suppliersPath:
        response = getSuppliers()
    elif httpMethod == postMethod and path == supplierPath:
        response = saveSupplier(json.loads(event['body']))
    elif httpMethod == patchMethod and path == supplierPath:
        requestBody = json.loads(event['body'])
        response = modifySupplier(requestBody['supplierId'],requestBody['updateKey'],requestBody['updateValue'])
    elif httpMethod == deleteMethod and path == supplierPath:
        requestBody = json.loads(event['body'])
        response = deleteSupplier(requestBody['supplierId'])
    else:
        response = buildResponse(404,'Not Found')
    return response

def getSupplier(supplierId):
    try:
        response = table.get_item(Key={'supplierId': supplierId})
        if 'Item' in response:
            return buildResponse(200,response['Item'])
        else:
            return buildResponse(404,f'Supplier with ID {supplierId} not found')
    except:
        logger.error('Error getting supplier with ID: %s', supplierId)
        return buildResponse(500,f'Error getting supplier with ID: {supplierId}')

def getSuppliers():
    try:
        response = table.scan()
        result = response['Items']
        while 'LastEvaluatedKey' in response:
            response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            result.extend(response['Items'])
        
        body = {
            'suppliers': result
        }
        return buildResponse(200,body)
    except:
        logger.error('Error getting suppliers')
        return buildResponse(500,f'Error getting suppliers')

def saveSupplier(requestBody):
    try:
        table.put_item(Item=requestBody)
        body = {
            'Operation': 'SAVE',
            'Message': 'SUCCESS',
            'Item': requestBody
        }
        return buildResponse(200,body)
    except Exception as error:
        logger.error('Error saving supplier: %s', error)
        return buildResponse(500,f'Error saving supplier: {requestBody}')

def modifySupplier(supplierId, updateKey, updateValue):
    try:
        response = table.update_item(
            Key={'supplierId': supplierId},
            UpdateExpression=f'set {updateKey} = :val',
            ExpressionAttributeValues={':val': updateValue},
            ReturnValues='UPDATED_NEW')
        body = {
            'Operation': 'UPDATE',
            'Message': 'SUCCESS',
            'UpdatedAttributes': response['Attributes']
        }
        return buildResponse(200,body)
    except:
        logger.error('Error modifying supplier with ID: %s', supplierId)
        return buildResponse(500,f'Error modifying supplier with ID: {supplierId}')

def deleteSupplier(supplierId):
    try:
        response = table.delete_item(Key={'supplierId': supplierId},ReturnValues='ALL_OLD')
        body = {
            'Operation': 'DELETE',
            'Message': 'SUCCESS',
            'DeletedItem': response
        }
        return buildResponse(200,body)
    except:
        logger.error('Error deleting supplier with ID: %s', supplierId)
        return buildResponse(500,f'Error deleting supplier with ID: {supplierId}')

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