import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {NavLink} from 'react-router-dom';

export default class ClubInformation extends Component {
  static propTypes = {
    club: PropTypes.object.isRequired
  };

  render () {
    let club = this.props.club;
    let {shortName, _id} = club;
    return (
      <div>
        <nav className='level'>
          <div className='level-left'>
            <div className='level-item'>
              <h1 className='is-title is-size-3'>{shortName}</h1>
            </div>
          </div>
          <div className='level-right'>
            <div className='field is-grouped'>
              <p className='control'>
                <NavLink className='button is-primary' to={'/club/' + _id + '/edit'}>Edit</NavLink>
              </p>
              <p className='control'>
                <NavLink className='button is-danger' to={'/club/' + _id + '/delete'}>Delete</NavLink>
              </p>
            </div>
          </div>
        </nav>
      </div>
    );
  }
}
