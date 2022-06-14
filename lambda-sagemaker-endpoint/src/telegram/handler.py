import logging
import telegram
import os
import requests
import json

"""
A simple Lambda function which acts as a Telegram webhook handler. It takes
updates from Telegram sends a response to the chat the update came from.
The response is fetched through another API call. In practice it will call the
SageMaker handler which then calls SageMaker.
"""

RESPONSE_URL = os.getenv('RESPONSE_URL')
TELEGRAM_API_KEY = os.getenv('TELEGRAM_API_KEY')


def handler(event, context):
    print(event)

    body = json.loads(event['body'])
    if 'message' not in body:
        'No message'

    message = body['message']
    if 'text' not in message:
        'No text'

    text = message['text']
    chat_id = message['chat']['id']

    response = get_response(text)
    send_message(response, chat_id)

    return {
        'message': message,
        'response': response
    }


def get_response(prompt):
    request_body = {
        prompt: prompt
    }
    response = requests.post(RESPONSE_URL, json=request_body)
    print(response)
    response_text = response.json()['response']
    return response_text


def send_message(message, chat_id):
    bot = telegram.Bot(TELEGRAM_API_KEY)
    logging.basicConfig(
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    bot.send_message(chat_id, message)
