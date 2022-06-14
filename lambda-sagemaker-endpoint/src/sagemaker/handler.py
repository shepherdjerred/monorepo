import json
import os
import boto3

ENDPOINT_NAME = os.environ['ENDPOINT_NAME']
sagemaker_client = boto3.client('runtime.sagemaker')


def handler(event, context):
    print(event)

    body = json.dumps(json.loads(event['body']))

    response = sagemaker_client.invoke_endpoint(EndpointName=ENDPOINT_NAME,
                                                ContentType='application/json',
                                                Body=body)
    print(response)

    result = json.loads(response['Body'].read().decode())
    print(result)
    return result
