from flask import Flask, request
from deploy.generate import generate_response
from flask import jsonify

app = Flask(__name__)


@app.route('/')
def index():
    return f'gpt-2-simple-sagemaker-container'


@app.route('/ping')
def ping():
    return jsonify('pong')


@app.route('/invocations', methods=['POST'])
def invocations():
    print(request)

    request_json = request.json

    validation_status = is_valid_invocation(request_json)
    if validation_status[0] is False:
        return jsonify({
            'Error': validation_status[1]
        })

    prompt = request_json['prompt']

    response = generate_response(prompt)
    print(f'prompt: {prompt}\nresponse: {response}')

    return jsonify({
        'prompt': prompt,
        'response': response
    })


def is_valid_invocation(invocation_body):
    if 'prompt' not in invocation_body:
        return False, 'Prompt not provided'
    return True, 'Invocation is valid'

