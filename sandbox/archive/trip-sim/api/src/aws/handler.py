from aws.request import from_lambda_request
from model.simulation.simulate import simulate


def handler(event, context):
    simulation_request = from_lambda_request(event)

    results = simulate(
        simulation_request.vehicles,
        simulation_request.distance,
        simulation_request.average_cost_per_gallon_of_gas,
        simulation_request.average_cost_per_night_at_hotel,
        simulation_request.max_people_per_room,
        range(simulation_request.min_people, simulation_request.max_people + 1),
        range(simulation_request.min_days, simulation_request.max_days + 1),
        simulation_request.return_flight_cost,
        simulation_request.average_cost_of_food_per_day_per_person
    )

    return [result.to_dict() for result in results]
