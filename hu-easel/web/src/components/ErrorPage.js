import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class ErrorPage extends Component {
  static propTypes = {
    title: PropTypes.string,
    message: PropTypes.string
  };

  render () {
    return (
      <section>
        <div>
          <h1>
            { this.props.title }
          </h1>
          <h2>
            { this.props.message }
          </h2>
        </div>
      </section>
    );
  }
}
