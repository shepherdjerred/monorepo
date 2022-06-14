import React, {Component} from "react";
import axios from "axios"
import {Loader} from "../loader/Loader";

type SimulationFetcherState = {
  isLoading: boolean
  result: string
}

type Range = {
  minimum: number
  maximum: number
}

type Vehicle = {
  name: string
  capacity: number
  costPerDay: number
  milesPerGallon: number
}

type JsonRange = {
  min: number
  max: number
}

type JsonVehicle = {
  name: string
  capacity: number
  cost_per_day: number
  miles_per_gallon: number
}

type JsonSimulationRequest = {
  vehicles: JsonVehicle[]
  distance: number
  average_cost_per_gallon_of_gas: number
  average_cost_per_night_at_hotel: number
  max_people_per_room: number
  average_cost_of_food_per_day_per_person: number
  return_flight_cost: number
  people: JsonRange
  days: JsonRange
}

type SimulationRequest = {
  vehicles: Vehicle[]
  distance: number
  averageCostPerGallonOfGas: number
  averageCostPerNightAtHotel: number
  maxPeoplePerRoom: number
  averageCostOfFoodPerDayPerPerson: number
  returnFlightCost: number
  people: Range
  days: Range
}

type SimulationResult = {
  numberOfPeople: number
  numberOfDays: number
  gasCost: number
  rentalCost: number
  lodgingCost: number
  flightCost: number
  foodCost: number
  totalCost: number
  costPerPerson: number
  costPerDay: number
  costPerDayPerPerson: number
}

export class SimulationFetcher extends Component<any, SimulationFetcherState> {
  constructor() {
    super({});
    this.state = {
      isLoading: true,
      result: ""
    }
  }

  componentDidMount() {
    let request = {
      vehicles: [
        {
          name: "Rental Van",
          capacity: 7,
          costPerDay: 100,
          milesPerGallon: 20
        },
        {
          name: "Rental Sedan",
          capacity: 5,
          costPerDay: 100,
          milesPerGallon: 40
        }
      ],
      distance: 3061,
      averageCostPerGallonOfGas: 2.25,
      averageCostPerNightAtHotel: 150,
      maxPeoplePerRoom: 5,
      averageCostOfFoodPerDayPerPerson: 7,
      returnFlightCost: 124,
      people: {
        minimum: 2,
        maximum: 3
      },
      days: {
        minimum: 5,
        maximum: 6
      }
    };

    this.sendRequest(request)
    .then((result) => {
      this.setState({
        isLoading: false,
        result: JSON.stringify(result)
      });
    })
    .catch((result) => {
      this.setState({
        isLoading: false,
        result: JSON.stringify(result)
      });
    })
  }

  async sendRequest(request: SimulationRequest) {
    const API_URL = 'https://api.tripsim.shepherdjerred.com';
    return (await axios.post(API_URL, this.requestToJsonRequest(request))).data;
  }

  requestToJsonRequest(request: SimulationRequest): JsonSimulationRequest {
    return {
      vehicles: this.vehiclesToJsonVehicles(request.vehicles),
      distance: request.distance,
      average_cost_per_gallon_of_gas: request.averageCostPerGallonOfGas,
      average_cost_per_night_at_hotel: request.averageCostPerNightAtHotel,
      max_people_per_room: request.maxPeoplePerRoom,
      average_cost_of_food_per_day_per_person: request.averageCostOfFoodPerDayPerPerson,
      return_flight_cost: request.returnFlightCost,
      people: this.rangeToJsonRange(request.people),
      days: this.rangeToJsonRange(request.days)
    }
  }

  vehiclesToJsonVehicles(vehicles: Vehicle[]): JsonVehicle[] {
    return vehicles.map((vehicle) => {
      return this.vehicleToJsonVehicle(vehicle)
    });
  }

  vehicleToJsonVehicle(vehicle: Vehicle): JsonVehicle {
    return {
      name: vehicle.name,
      capacity: vehicle.capacity,
      cost_per_day: vehicle.costPerDay,
      miles_per_gallon: vehicle.milesPerGallon
    }
  }

  rangeToJsonRange(range: Range): JsonRange {
    return {
      min: range.minimum,
      max: range.maximum
    }
  }

  render() {
    return (
        <Loader isLoading={this.state.isLoading}>
          {this.state.result}
        </Loader>
    )
  }
}
