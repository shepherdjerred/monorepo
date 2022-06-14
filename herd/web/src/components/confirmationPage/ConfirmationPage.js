import PropTypes from 'prop-types';
import React, {Component} from 'react';
import './ConfirmationPage.css';

export default class ConfirmationPage extends Component {
  constructor (props) {
    super(props);
    this.state = {
      hasBeenSubmitted: false
    };
  }

  render () {
    return (

    );
  }
}

ConfirmationPage.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string,
  onConfirm: PropTypes.func,
  onCancel: PropTypes.func
};
