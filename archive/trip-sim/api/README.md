# Roadtrip Cost Simulator

A little program to help calculate the cost of a road trip. Intended for a road trip where a car is rented and with the passengers flying back. It can be used for a round trip by omitting flight costs and doubling the distance.

## Features

- Simulates the price for a road trip for a range of passengers and duration so that cost can be compared.
- Chooses the most cost-efficient rental vehicles from a given options
- Calculates number of cars needed and number of lodging rooms needed based on passengers
- Provides CLI output in an easy-to-understand format through pandas
- Includes an AWS Lambda handler for a simple JSON API
- Easy to deploy to [AWS Lambda](https://aws.amazon.com/lambda/) with [SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html)

## View Live

Interactive tool for REST requests: https://reqbin.com/f6dck49c

## Usage

There is no user interface, so the source must be edited directly. The relevant file is `__init__.py`. Everything else should (probably) be untouched.

Alternatively you can deploy this to AWS Lambda and make requests against it. The easiest way to deploy this is with [SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html). After setting SAM up, run the following commands:

```bash
sam validate; sam build; sam package; sam deploy
```

### Example Lambda Request

```bash
{
  "vehicles": [
    {
      "name": "Rental Van",
      "capacity": 7,
      "cost_per_day": 100,
      "miles_per_gallon": 20
    },
    {
      "name": "Rental Sedan",
      "capacity": 5,
      "cost_per_day": 100,
      "miles_per_gallon": 40
    }
  ],
  "distance": 3061,
  "average_cost_per_gallon_of_gas": 2.25,
  "average_cost_per_night_at_hotel": 150,
  "max_people_per_room": 5,
  "average_cost_of_food_per_day_per_person": 7,
  "return_flight_cost": 124,
  "people": {
    "min": 2,
    "max": 3
  },
  "days": {
    "min": 5,
    "max": 6
  }
}
```

### Example Lambda Response

```bash
[
  {
    "number of people": 2,
    "number of days": 5,
    "gas cost": 172.18125,
    "rental cost": 500,
    "lodging cost": 600,
    "flight cost": 124,
    "food cost": 70,
    "total cost": 1466.18125,
    "cost per person": 733.090625,
    "cost per day": 293.23625000000004,
    "cost per day per person": 146.61812500000002
  },
  {
    "number of people": 2,
    "number of days": 6,
    "gas cost": 172.18125,
    "rental cost": 600,
    "lodging cost": 750,
    "flight cost": 124,
    "food cost": 84,
    "total cost": 1730.18125,
    "cost per person": 865.090625,
    "cost per day": 288.36354166666666,
    "cost per day per person": 144.18177083333333
  },
  {
    "number of people": 3,
    "number of days": 5,
    "gas cost": 172.18125,
    "rental cost": 500,
    "lodging cost": 600,
    "flight cost": 124,
    "food cost": 105,
    "total cost": 1501.18125,
    "cost per person": 500.39375,
    "cost per day": 300.23625000000004,
    "cost per day per person": 100.07875000000001
  },
  {
    "number of people": 3,
    "number of days": 6,
    "gas cost": 172.18125,
    "rental cost": 600,
    "lodging cost": 750,
    "flight cost": 124,
    "food cost": 126,
    "total cost": 1772.18125,
    "cost per person": 590.7270833333333,
    "cost per day": 295.36354166666666,
    "cost per day per person": 98.45451388888888
  }
]
```

## Example CLI Output

```bash
   number of people  number of days  gas cost  rental cost  lodging cost  flight cost  food cost  total cost  cost per person  cost per day  cost per day per person
6                 3               7     153.0          700           750          124        147      1874.0            625.0         268.0                     89.0
7                 3               8     153.0          800           875          124        168      2120.0            707.0         265.0                     88.0
8                 3               9     153.0          900          1000          124        189      2366.0            789.0         263.0                     88.0
3                 2               7     153.0          700           750          124         98      1825.0            913.0         261.0                    130.0
4                 2               8     153.0          800           875          124        112      2064.0           1032.0         258.0                    129.0
5                 2               9     153.0          900          1000          124        126      2303.0           1152.0         256.0                    128.0
0                 1               7     153.0          700           750          124         49      1776.0           1776.0         254.0                    254.0
1                 1               8     153.0          800           875          124         56      2008.0           2008.0         251.0                    251.0
2                 1               9     153.0          900          1000          124         63      2240.0           2240.0         249.0                    249.0
```
