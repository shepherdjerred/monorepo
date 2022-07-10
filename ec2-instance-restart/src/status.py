from common import handle_request
from operation import Operation


def handler(event, context):
    return handle_request(event, Operation.LIST)
