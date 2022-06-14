import datetime
import json
import re

import boto3
import requests

# Probably not great to commit this, but this is a quick script and I don't want to deal with properly securing it.
TRACKING_NUMBERS = [
    ("60058350", "Chair"),
    ("60058351", "Chair"),
    ("60058352", "Chair"),
    ("60058353", "Chair"),
    ("60058354", "Chair"),
    ("60058355", "Chair"),
    ("60058356", "Table"),
    ("60058357", "Rug")
]

ENDPOINT = "https://www.westelm.com/customer-service/order-tracking/index.json?carrier=WSI&trackingNumber="
SNS_TOPIC = "arn:aws:sns:us-east-1:692594597524:WestElmShipmentNotifications"


def handler(event, context):
    updated_responses = []
    tracking_infos = get_tracking_info()

    for tracking_info in tracking_infos:
        if does_track_info_have_recent_activity(tracking_info):
            updated_responses.append(tracking_info)

    print(f"Recent updates: {updated_responses}")
    if len(updated_responses) > 0:
        notify(updated_responses)


def does_track_info_have_recent_activity(tracking_info):
    activities = tracking_info["trackingDetailBean"]["activityList"]
    activity_times = map(
        lambda activity: time_string_to_datetime(activity["activityDate"]),
        activities)

    sorted_activity_times = sorted(activity_times)

    last_update = sorted_activity_times[-1]
    now = datetime.datetime.now()
    delta = now - last_update

    print(delta)

    return delta.total_seconds() / 60 / 60 < 24


def get_tracking_info():
    tracking_responses = []
    for tracking_number in TRACKING_NUMBERS:
        url = ENDPOINT + tracking_number[0]
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.75 Safari/537.36',
        }
        response = requests.get(url, headers=headers)
        print(response.content)
        response_json = json.loads(response.content)
        tracking_responses.append(response_json)
    return tracking_responses


def notify(json_message):
    """
    Sends a JSON message via SNS
    """
    client = boto3.client('sns')
    response = client.publish(
        TopicArn=SNS_TOPIC,
        Message=json.dump(json_message),
        Subject='West Elm Shipping Notification',
        MessageStructure='string',
    )
    print(response)


def time_string_to_datetime(time_string):
    """
    Converts a time string to a datetime
    """
    result = re.search(
        "([A-Za-z]+)\. ([0-9]{1,2}), ([0-9]{4}) ([0-9]{1,2}):([0-9]{2}) (AM|PM)",
        time_string)
    month = abbreviation_to_month(result.group(1))
    day = int(result.group(2))
    year = int(result.group(3))
    hour = int(result.group(4))
    minute = int(result.group(5))
    am_pm = result.group(6)

    if am_pm == "PM":
        hour += 12

    return datetime.datetime(year, month, day, hour, minute)


def abbreviation_to_month(abbreviation):
    """
    Converts an abbreviated month string into a integer
    """
    if abbreviation == "Oct":
        return 10
    if abbreviation == "Nov":
        return 11
    raise NotImplementedError


if __name__ == "__main__":
    handler(None, None)
