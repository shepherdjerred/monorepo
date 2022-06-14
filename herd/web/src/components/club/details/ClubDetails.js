import React, {Component} from 'react';
import ClubDetailsNavigationContainer from './ClubDetailsNavigationContainer';
import ClubDetailsRouterContainer from './ClubDetailsRouterContainer';
import PropTypes from 'prop-types';

export default class ClubDetails extends Component {
  static propTypes = {
    club: PropTypes.object.isRequired
  };

  render () {
    let club = this.props.club;
    let {_id} = club;
    return (
      <div className='container'>
        <div className='columns'>
          <div className='column is-one-fifth'>
            <ClubDetailsNavigationContainer clubId={_id} />
          </div>
          <div className='column is-four-fifths'>
            <ClubDetailsRouterContainer club={club} />
          </div>
        </div>
      </div>
    );
  }
}
