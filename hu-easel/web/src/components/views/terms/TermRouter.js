import React, { Component } from 'react';
import { Route, Switch } from 'react-router-dom';
import CreateTerm from './read/create/CreateTerm';
import PropTypes from 'prop-types';
import TermListContainer from './read/list/TermListContainer';

export class TermRouter extends Component {
  static propTypes = {
    match: PropTypes.object.isRequired
  };

  render () {
    const { match } = this.props;
    return (
      <Switch>
        <Route
          path={match.url}
          component={TermListContainer} exact />
        <Route
          path={match.url + '/create'}
          component={CreateTerm} />
      </Switch>
    );
  }
}
