import PropTypes from 'prop-types';
import React, {Component} from 'react';
import './common/errorNotification/ErrorNotification.css';

class ErrorPage extends Component {
  render () {
    return (
      <section className='hero is-danger'>
        <div className='hero-body'>
          <div className='container'>
            <h1 className='title'>
              { this.props.title }
            </h1>
            <h2 className='subtitle'>
              { this.props.message }
            </h2>
          </div>
        </div>
      </section>
    );
  }
}

ErrorPage.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string
};

export default ErrorPage;
