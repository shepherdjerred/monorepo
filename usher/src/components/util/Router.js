import React from 'react';
import { Route, Switch } from 'react-router';
import Home from '../views/Home';
import CheckForSeat from '../views/CheckForSeat';
import GetSeat from '../views/GetSeats';
import PickSeat from '../views/PickSeat';
import ReleaseSeat from '../views/ReleaseSeat';

export default function Router () {
  return (
    <Switch>
      <Route path='/' component={Home} exact />
      <Route path='/checkForSeat' component={CheckForSeat} />
      <Route path='/getSeats' component={GetSeat} />
      <Route path='/pickSeat' component={PickSeat} />
      <Route path='/releaseSeat' component={ReleaseSeat} />
    </Switch>
  );
}
