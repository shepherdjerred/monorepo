import React, {Component} from 'react';
import { Link, NavLink } from 'react-router-dom';

export default class Navbar extends Component {
  constructor (props) {
    super(props);
    this.state = {
      isNavbarMenuActive: false
    };
  }

  toggleNavbarMenuActive () {
    this.setState(previousState => {
      return {
        isNavbarMenuActive: !previousState.isNavbarMenuActive
      };
    });
  }

  isNavbarMenuActive () {
    return this.state.isNavbarMenuActive;
  }

  render () {
    return (
      <nav className='navbar is-light' role='navigation' aria-label='main navigation'>
        <div className='navbar-brand'>
          <NavLink className='navbar-item' to='/' activeClassName='is-active' exact>
            Usher
          </NavLink>
          <a role='button' className={'navbar-burger ' + (this.isNavbarMenuActive() ? 'is-active' : '')}
            aria-label='menu' aria-expanded='false' onClick={event => this.toggleNavbarMenuActive(event)}>
            <span aria-hidden='true' />
            <span aria-hidden='true' />
            <span aria-hidden='true' />
          </a>
        </div>
        <div className={'navbar-end navbar-menu' + (this.isNavbarMenuActive() ? 'is-active' : '')}>
          <Link to='/checkForSeat' className='navbar-item'>
            Check For Seat
          </Link>
          <Link to='getSeats' className='navbar-item'>
            Get Seats
          </Link>
          <Link to='pickSeat' className='navbar-item'>
            Pick Seat
          </Link>
          <Link to='releaseSeat' className='navbar-item'>
            Release Seat
          </Link>
        </div>
      </nav>
    );
  }
}
