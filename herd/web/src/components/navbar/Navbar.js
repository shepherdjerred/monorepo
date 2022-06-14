import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {NavLink} from 'react-router-dom';

export default class Navbar extends Component {
  static propTypes = {
    isLoggedIn: PropTypes.bool.isRequired,
    firstName: PropTypes.string,
    lastName: PropTypes.string,
    _id: PropTypes.string,
    onLogout: PropTypes.func.isRequired
  };

  state = {
    isNavbarMenuActive: false
  };

  toggleNavbarMenuActive = () => {
    this.setState(previousState => {
      return {
        isNavbarMenuActive: !previousState.isNavbarMenuActive
      };
    });
  };

  isNavbarMenuActive = () => {
    return this.state.isNavbarMenuActive;
  };

  renderNavbar = () => {
    let {isLoggedIn, firstName, lastName, _id, onLogout} = this.props;
    if (isLoggedIn) {
      return (
        <div className='navbar-end'>
          <NavLink className='navbar-item' to='/club/list/' activeClassName='is-active' exact>
            Clubs
          </NavLink>
          <div className='navbar-item has-dropdown is-hoverable'>
            <NavLink className='navbar-link' to={'/user/' + _id + '/details'} activeClassName='is-active' exact>
              {firstName} {lastName}
            </NavLink>
            <div className='navbar-dropdown is-right'>
              <NavLink className='navbar-item' to={'/user/' + _id + '/details'} activeClassName='is-active' exact>
                My Account
              </NavLink>
              <a className='navbar-item' onClick={onLogout}>Logout</a>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className='navbar-end'>
          <NavLink className='navbar-item' to='/login' activeClassName='is-active' exact>
            Login
          </NavLink>
          <NavLink className='navbar-item' to='/register' activeClassName='is-active' exact>
            Register
          </NavLink>
        </div>
      );
    }
  };

  render () {
    let {isNavbarMenuActive, toggleNavbarMenuActive, renderNavbar} = this;
    return (
      <nav className='navbar is-light' role='navigation' aria-label='main navigation'>
        <div className='container'>
          <div className='navbar-brand'>
            <NavLink className='navbar-item' to='/' activeClassName='is-active' exact>
            Herd
            </NavLink>
            <a role='button' className={'navbar-burger ' + (isNavbarMenuActive() ? 'is-active' : '')}
              aria-label='menu' aria-expanded='false' onClick={event => toggleNavbarMenuActive(event)}>
              <span aria-hidden='true' />
              <span aria-hidden='true' />
              <span aria-hidden='true' />
            </a>
          </div>
          <div className={'navbar-menu ' + (isNavbarMenuActive() ? 'is-active' : '')}>
            {renderNavbar()}
          </div>
        </div>
      </nav>
    );
  }
}
