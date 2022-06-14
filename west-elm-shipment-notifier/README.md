# West Elm Shipment Notifications
West Elm takes a very long time to ship orders. They also provide an interface that I don't really like. As far as I know they provide no way to be updated when a shipment status changes. This projects calls West Elm APIs every hour and sends an email when the ship status has been updated.

API shape
```
{
  "trackingDetailBean": {
    "trackingNumber": "WSI2548978272LTL",
    "status": "IN_TRANSIT",
    "carrier": "WSI",
    "carrierDisplayName": "WSI",
    "service": "REGULAR",
    "activityList": [
      {
        "activityDate": "Oct. 12, 2020 2:24 PM",
        "status": null,
        "location": "Fontana, CA",
        "activityDescription": "SHIPPED"
      }
    ],
    "leftAt": null,
    "signedBy": null,
    "weight": "22.50 LBS",
    "carrierTrackingURL": "",
    "actualDeliveryDate": null,
    "expectedDeliveryDate": null,
    "trackingErrors": null
  }
}
```
