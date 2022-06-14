import PropTypes from 'prop-types';
import React, {Component} from 'react';
import './ErrorNotification.css';

class ErrorNotification extends Component {
  render () {
    return (
      <div className='error notification is-danger'>
        {this.props.title && <h2 className='error--title'>{this.props.title}</h2>}
        {this.props.message && <p className='error--message'>{this.props.message}</p>}
        {this.props.stack && <p className='error--message'>{this.props.stack}</p>}
        {this.props.retry && (<button className='button is-danger is-inverted is-fullwidth'>Retry</button>)}
      </div>
    );
  }
}

ErrorNotification.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string,
  stack: PropTypes.string,
  retry: PropTypes.bool
};

export default ErrorNotification;
