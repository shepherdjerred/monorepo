class Request:
    def __init__(self, instance_id, region, aws_access_key_id, aws_secret_access_key):
        self.instance_id = instance_id
        self.region = region
        self.aws_access_key_id = aws_access_key_id
        self.aws_secret_access_key = aws_secret_access_key
