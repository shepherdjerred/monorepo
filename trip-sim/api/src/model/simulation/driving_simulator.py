def simulate(vehicles, distance, number_of_people, number_of_days, average_cost_of_gas_per_gallon):
    return find_most_efficient_vehicles_for_number_of_people(vehicles, distance, number_of_people, number_of_days, average_cost_of_gas_per_gallon)


def find_most_efficient_vehicles_for_number_of_people(vehicles, distance, number_of_people, number_of_days, average_cost_of_gas_per_gallon):
    combinations = valid_combinations_of_vehicles(vehicles, number_of_people, set([]))
    combinations_of_vehicles_with_costs = map(lambda vehicles: (vehicles, cost_for_vehicles(vehicles, distance, number_of_days, average_cost_of_gas_per_gallon)), combinations)
    best_vehicle_combination = sorted(combinations_of_vehicles_with_costs, key=lambda x: x[1][0] + x[1][1])[0]
    return best_vehicle_combination


def valid_combinations_of_vehicles(vehicles, number_of_people, memo):
    capacity = sum(vehicle.capacity for vehicle in vehicles)
    if capacity < number_of_people:
        return []

    result = [vehicles]
    for index in range(len(vehicles)):
        vehicles_without_index = list.copy(vehicles)
        vehicles_without_index.pop(index)
        hash_val = hash(str(vehicles_without_index))  # sorry
        if hash_val in memo:
            continue
        memo.add(hash_val)
        result += valid_combinations_of_vehicles(vehicles_without_index, number_of_people, memo)
    return result


def cost_for_vehicles(vehicles, distance, number_of_days, average_cost_of_gas_per_gallon):
    vehicle_cost = 0
    gas_cost = 0
    for vehicle in vehicles:
        vehicle_cost += vehicle.cost_per_day * number_of_days
        gas_cost += (distance / vehicle.miles_per_gallon) * average_cost_of_gas_per_gallon
    return vehicle_cost, gas_cost
