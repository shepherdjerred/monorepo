from model.vehicle import Vehicle


class Request:
    def __init__(self,
        vehicles,
        distance,
        average_cost_per_gallon_of_gas,
        average_cost_per_night_at_hotel,
        max_people_per_room,
        average_cost_of_food_per_day_per_person,
        return_flight_cost,
        min_people,
        max_people,
        min_days,
        max_days):
        self.vehicles = vehicles
        self.distance = distance
        self.average_cost_per_gallon_of_gas = average_cost_per_gallon_of_gas
        self.average_cost_per_night_at_hotel = average_cost_per_night_at_hotel
        self.max_people_per_room = max_people_per_room
        self.average_cost_of_food_per_day_per_person = average_cost_of_food_per_day_per_person
        self.return_flight_cost = return_flight_cost
        self.min_people = min_people
        self.max_people = max_people
        self.min_days = min_days
        self.max_days = max_days


def vehicles_from_request(vehicles):
    vehicles_as_classes = []
    for vehicle in vehicles:
        vehicle_as_class = Vehicle(vehicle['name'],
                                   vehicle['capacity'],
                                   vehicle['cost_per_day'],
                                   vehicle['miles_per_gallon'])
        vehicles_as_classes.append(vehicle_as_class)
    return vehicles_as_classes


def from_lambda_request(request):
    vehicles = vehicles_from_request(request['vehicles'])
    return Request(vehicles,
                   request['distance'],
                   request['average_cost_per_gallon_of_gas'],
                   request['average_cost_per_night_at_hotel'],
                   request['max_people_per_room'],
                   request['average_cost_of_food_per_day_per_person'],
                   request['return_flight_cost'],
                   request['people']['min'],
                   request['people']['max'],
                   request['days']['min'],
                   request['days']['max'])
