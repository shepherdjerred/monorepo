import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Redirect, Route, Switch} from 'react-router-dom';
import LoginView from '../authentication/login/LoginView';
import LoginHelpView from '../authentication/loginHelp/LoginHelpView';
import RegisterView from '../authentication/register/RegisterView';
import RegisterHelpView from '../authentication/registerHelp/RegisterHelpView';
import ClubRouter from '../club/ClubRouter';
import ErrorBoundary from '../ErrorBoundary';
import ErrorPage from '../ErrorPage';
import Home from '../home/Home';
import UserDetails from '../user/details/UserDetails';

export default class RootRouter extends Component {
  static propTypes = {
    isLoggedIn: PropTypes.bool.isRequired
  };

  render () {
    let {isLoggedIn} = this.props;
    return (
      <div>
        <ErrorBoundary>
          <Switch>
            <Route path='/' exact
              render={() => {
                return isLoggedIn ? <Redirect to='/club/list' /> : <Home />;
              }}
            />

            <Route path='/login' exact
              render={() => {
                return isLoggedIn ? <Redirect to='/' /> : <LoginView />;
              }}
            />

            <Route path='/login/help' exact
              component={LoginHelpView} />

            <Route path='/register' exact
              render={() => {
                return isLoggedIn ? <Redirect to='/' /> : <RegisterView />;
              }}
            />

            <Route path='/register/help' exact
              component={RegisterHelpView} />

            <Route path='/user/:id/details'
              render={() => {
                return isLoggedIn ? <UserDetails /> : <LoginView />;
              }}
            />

            <Route path='/club'
              render={() => {
                return isLoggedIn ? <ClubRouter /> : <LoginView />;
              }}
            />

            <Route
              render={() => <ErrorPage title='Page not found'
                message='The page you were looking for could not be found' />}
            />
          </Switch>
        </ErrorBoundary>
      </div>
    );
  }
}
