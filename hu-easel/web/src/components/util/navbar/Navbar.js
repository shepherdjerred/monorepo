import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';

export default class Navbar extends Component {
  static propTypes = {
    isLoggedIn: PropTypes.bool.isRequired,
    username: PropTypes.string.isRequired,
    onLogout: PropTypes.func.isRequired
  };

  renderAccountLink = () => {
    const { isLoggedIn, username, onLogout } = this.props;
    if (isLoggedIn) {
      return (
        <li>
          <Link to='/login' onClick={onLogout}>Log out of {username}</Link>
        </li>
      );
    } else {
      return (
        <li>
          <Link to='/login'>Login</Link>
        </li>
      );
    }
  };

  render () {
    return (
      <div>
        <h1>EASEL</h1>
        <ul>
          <li>
            <Link to='/'>Home</Link>
          </li>
          { this.renderAccountLink() }
          <li>
            <Link to='/users'>Users</Link>
          </li>
          <li>
            <Link to='/courses'>Courses</Link>
            <ul>
              <li>
                <Link to='/courses/contents'>Contents</Link>
              </li>
              <li>
                <Link to='/courses/listings'>Listings</Link>
              </li>
            </ul>
          </li>
          <li>
            <Link to='/terms'>Terms</Link>
          </li>
        </ul>
      </div>
    );
  }
}
