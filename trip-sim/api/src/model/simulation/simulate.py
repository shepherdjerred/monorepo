from model.simulation import food_simulator, lodging_simulator, \
    driving_simulator
from model.simulation.simulation_result import SimulationResult


def simulate(vehicles, distance, average_cost_per_gallon_of_gas, average_cost_of_hotel_room_per_night, max_people_per_room, people_range, day_range, ticket_cost, average_cost_of_food_per_day_per_person):
    results = []
    for number_of_people in people_range:
        for number_of_days in day_range:
            driving_cost = driving_simulator.simulate(vehicles, distance, number_of_people, number_of_days, average_cost_per_gallon_of_gas)
            lodging_cost = lodging_simulator.simulate(number_of_people, number_of_days, average_cost_of_hotel_room_per_night, max_people_per_room)
            flight_cost = ticket_cost
            food_cost = food_simulator.simulate(number_of_people, number_of_days, average_cost_of_food_per_day_per_person)
            results.append(SimulationResult(number_of_people, number_of_days, driving_cost, lodging_cost, flight_cost, food_cost))
    return results
