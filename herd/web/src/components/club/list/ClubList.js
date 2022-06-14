import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Link} from 'react-router-dom';

class ClubList extends Component {
  render () {
    let clubs = Object.keys(this.props.clubs).map((key) => (
      <tr key={key}>
        <td>
          <Link to={{pathname: '/club/' + this.props.clubs[key].data._id + '/details/'}}>{this.props.clubs[key].data.name}</Link>
        </td>
        <td>
          { this.props.clubs[key].data.members.length }
        </td>
      </tr>
    ));
    return (
      <table className='table is-fullwidth'>
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
          </tr>
        </thead>
        <tbody>
          {clubs}
        </tbody>
      </table>
    );
  }
}

ClubList.propTypes = {
  clubs: PropTypes.object.isRequired
};

export default ClubList;
