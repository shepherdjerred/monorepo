from math import ceil


def simulate(number_of_people, number_of_days, cost_per_night, max_people_per_room):
    number_of_rooms = ceil(number_of_people / max_people_per_room)
    return number_of_rooms * (number_of_days - 1) * cost_per_night
