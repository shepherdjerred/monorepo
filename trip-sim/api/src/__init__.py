from model.simulation.simulate import simulate
from model.vehicle import Vehicle
from model.visualizer import visualize

if __name__ == "__main__":
    vehicles = [
        Vehicle("Rental Van", 7, 101, 20),
        Vehicle("Efficient Sedan", 5, 100, 40)
    ] * 3

    distance_in_miles = 3061
    average_cost_per_gallon_of_gas = 2
    average_cost_per_night_at_hotel = 125
    max_people_per_room = 5
    average_cost_of_food_per_day_per_person = 7
    return_ticket_cost = 124

    results = simulate(
        vehicles,
        distance_in_miles,
        average_cost_per_gallon_of_gas,
        average_cost_per_night_at_hotel,
        max_people_per_room,
        range(4, 14 + 1),
        range(7, 14 + 1),
        return_ticket_cost,
        average_cost_of_food_per_day_per_person
    )

    visualize(results)
