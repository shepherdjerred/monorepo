class Vehicle:
    def __init__(self, name, capacity, cost_per_day, miles_per_gallon):
        self.name = name
        self.capacity = capacity
        self.cost_per_day = cost_per_day
        self.miles_per_gallon = miles_per_gallon

    def __repr__(self):
        return "name: {}, capacity: {}, cost per day: ${}, miles per gallon: {}".format(self.name,
                                                                                        self.capacity,
                                                                                        self.cost_per_day,
                                                                                        self.miles_per_gallon)
