class SimulationResult:
    def __init__(self, number_of_people, number_of_days, driving_cost, lodging_cost, flight_cost, food_cost):
        self.number_of_people = number_of_people
        self.number_of_days = number_of_days
        self.driving_cost = driving_cost
        self.lodging_cost = lodging_cost
        self.flight_cost = flight_cost
        self.food_cost = food_cost


    def to_dict(self):
        driving_cost_gas = self.driving_cost[1][1]
        driving_cost_rental = self.driving_cost[1][0]
        total_cost = driving_cost_gas + driving_cost_rental + self.lodging_cost + self.flight_cost + self.food_cost
        cost_per_person = total_cost / self.number_of_people
        cost_per_day = total_cost / self.number_of_days
        cost_per_day_per_person = cost_per_day / self.number_of_people
        return {
            "number of people": self.number_of_people,
            "number of days": self.number_of_days,
            "gas cost": driving_cost_gas,
            "rental cost": driving_cost_rental,
            "lodging cost": self.lodging_cost,
            "flight cost": self.flight_cost,
            "food cost": self.food_cost,
            "total cost": total_cost,
            "cost per person": cost_per_person,
            "cost per day": cost_per_day,
            "cost per day per person": cost_per_day_per_person
        }
