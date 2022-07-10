import json

import boto3
from jsonschema import validate
from discord_webhook import DiscordWebhook
import os

from operation import Operation
from request import Request


def create_client(region, aws_access_key_id, aws_secret_access_key):
    return boto3.client("ec2", region_name=region,
                        aws_access_key_id=aws_access_key_id,
                        aws_secret_access_key=aws_secret_access_key)


def create_response(status, body):
    return json.dumps({
        "statusCode": status,
        "body": body
    })


def convert_json(json_string):
    json_body = json.loads(json_string)
    request_format = {
        type: "object",
        "properties": {
            "instance_id": {
                type: "string"
            },
            "region": {
                type: "string"
            },
            "aws_access_key_id": {
                type: "string"
            },
            "aws_secret_access_key": {
                type: "string"
            }
        }
    }
    validate(json_body, request_format)
    return Request(json_body["instance_id"], json_body["region"],
                   json_body["aws_access_key_id"],
                   json_body["aws_secret_access_key"], )


def send_notification(request, operation):
    webhook_url = os.environ['WEBHOOK_URL']

    if operation == Operation.START:
        verb = "started"
    elif operation == Operation.STOP:
        verb = "stopped"
    else:
        return

    alias = get_instance_alias(request.instance_id)

    message = f"{alias} has been {verb}"
    webhook = DiscordWebhook(url=webhook_url, content=message)
    response = webhook.execute()
    print(response)


# TODO: this should be removed and replaced with some sort of generic aliasing mechanic
def get_instance_alias(instance_id):
    if instance_id == "i-0745805b004ea5306":
        return "factorio"
    elif instance_id == "i-0784bddc3df66775a":
        return "minecraft"
    elif instance_id == "i-099322e02b2ddd8ba":
        return "among us"
    else:
        return instance_id


def handle_request(event, operation):
    if "body" not in event:
        return create_response(400, "Bad request")
    request = convert_json(event["body"])
    ec2_client = create_client(request.region, request.aws_access_key_id,
                               request.aws_secret_access_key)
    instance_id = request.instance_id

    try:
        if operation == Operation.START:
            ec2_client.start_instances(InstanceIds=[instance_id])
            send_notification(request, operation)
            return create_response(200, f"Instance {instance_id} Started")
        elif operation == Operation.STOP:
            ec2_client.stop_instances(InstanceIds=[instance_id])
            send_notification(request, operation)
            return create_response(200, f"Instance {instance_id} Stopped")
        elif operation == Operation.LIST:
            status = ec2_client.describe_instance_status(
                InstanceIds=[
                    instance_id,
                ],
                DryRun=False,
                IncludeAllInstances=True
            )
            status = status["InstanceStatuses"][0]["InstanceState"]["Name"]
            return create_response(200, f"Instance {instance_id} is {status}")
    except Exception as e:
        return create_response(500, {
            "message": "Error when calling EC2",
            "details": str(e)
        })
