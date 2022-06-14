import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class UserInformation extends Component {
  static propTypes = {
    user: PropTypes.object.isRequired
  };

  render () {
    return (
      <div>
        <h1 className='is-title is-size-3'>{this.props.user.firstName} {this.props.user.lastName}</h1>
      </div>
    );
  }
}
