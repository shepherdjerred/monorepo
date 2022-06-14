import PropTypes from 'prop-types';
import React, { Component } from 'react';

export default class ErrorNotification extends Component {
  static propTypes = {
    title: PropTypes.string,
    message: PropTypes.string,
    stack: PropTypes.string,
    retry: PropTypes.bool
  };

  render () {
    return (
      <div className='error notification is-danger'>
        {this.props.title && <h2>{this.props.title}</h2>}
        {this.props.message && <p>{this.props.message}</p>}
        {this.props.stack && <p>{this.props.stack}</p>}
        {this.props.retry && (<button>Retry</button>)}
      </div>
    );
  }
}
