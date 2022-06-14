import React, {Component} from 'react';
import {Route, Switch} from 'react-router-dom';
import {CreateClubView} from './create/View';
import DeleteClubView from './delete/DeleteClubView';
import ClubDetailsView from './details/ClubDetailsView';
import EditClubView from './edit/EditClubView';
import ClubListView from './list/ClubListView';

export default class ClubRouter extends Component {
  render () {
    return (
      <Switch>
        <Route path='/club/list' exact
          render={() => {
            return <ClubListView />;
          }}
        />

        <Route path='/club/:id/details'
          render={({match}) => {
            return <ClubDetailsView clubId={match.params.id} />;
          }}
        />

        <Route path='/club/:id/delete'
          render={({match}) => {
            return <DeleteClubView clubId={match.params.id} />;
          }}
        />

        <Route path='/club/:id/edit'
          render={() => {
            return <EditClubView />;
          }}
        />

        <Route path='/club/create'
          render={() => {
            return <CreateClubView />;
          }}
        />
      </Switch>
    );
  }
}
