import React, { Component } from 'react';
import { Route, Switch } from 'react-router-dom';
import Home from '../../views/Home';
import Login from '../../views/login/Login';
import ErrorPage from '../../ErrorPage';
import { TermRouter } from '../../views/terms/TermRouter';
import PropTypes from 'prop-types';
import { Redirect } from 'react-router';

export default class Router extends Component {
  static propTypes = {
    isLoggedIn: PropTypes.bool.isRequired
  };

  render () {
    const { isLoggedIn } = this.props;
    return (
      <Switch>
        <Route
          path='/'
          exact
          component={Home} />
        <Route
          path='/login'
          render={() => {
            return isLoggedIn ? <Redirect to='/' /> : <Login />;
          }} />
        <Route
          path='/terms'
          render={(routerProps) => {
            return isLoggedIn ? <TermRouter {...routerProps} /> : <Login />;
          }} />

        <Route
          path='/'
          render={() => <ErrorPage title='Page not found'
            message='The page you were looking for could not be found' />} />
      </Switch>
    );
  }
}
