import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Link} from 'react-router-dom';

export default class ClubMembers extends Component {
  static propTypes = {
    club: PropTypes.object.isRequired
  };

  render () {
    let members = Object.keys(this.props.club.members).map((key) => {
      let member = this.props.club.members[key];
      return (
        <tr key={key}>
          <td>
            <Link to={{pathname: '/user/' + member._id + '/details'}}>{member.firstName} {member.lastName}</Link>
          </td>
          <td />
          <td>
            <div className='is-pulled-right'>
              <button className='button is-text'>Edit</button>
            </div>
          </td>
        </tr>
      );
    });

    return (
      <div>
        <nav className='level'>
          <div className='level-left'>
            <div className='level-item'>
              <h1 className='is-title is-size-3'>Members</h1>
            </div>
          </div>
          <div className='level-right'>
            <button className='button is-success'>Add Member</button>
          </div>
        </nav>
        <table className='table is-fullwidth is-hoverable'>
          <thead>
            <tr>
              <th>Name</th>
              <th>Office</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members}
          </tbody>
        </table>
      </div>
    );
  }
}
