import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Link} from 'react-router-dom';

class UserList extends Component {
  render () {
    let userListItems = Object.keys(this.props.users).map((key) => (
      <tr key={key}>
        <td>
          <Link
            to={{pathname: '/user/' + this.props.users[key]._id + '/details/'}}>{this.props.users[key].firstName + ' ' + this.props.users[key].lastName}
          </Link>
        </td>
        <td>
          <a href={'mailto:' + this.props.users[key].email}>{this.props.users[key].email}</a>
        </td>
      </tr>
    ));
    return (
      <table className='table is-fullwidth'>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {userListItems}
        </tbody>
      </table>
    );
  }
}

UserList.propTypes = {
  users: PropTypes.object.isRequired
};

export default UserList;
