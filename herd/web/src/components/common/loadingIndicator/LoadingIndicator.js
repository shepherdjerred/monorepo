import {faSpinnerThird} from '@fortawesome/pro-regular-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class LoadingIndicator extends Component {
  static propTypes = {
    delay: PropTypes.number
  };

  static defaultProps = {
    delay: 250
  };

  state = {
    render: false,
    timeoutId: null
  };

  componentDidMount () {
    let timeoutId = setTimeout(function () {
      this.setState({
        render: true
      });
    }.bind(this), this.props.delay);

    this.setState({
      timeoutId
    });
  }

  componentWillUnmount () {
    clearTimeout(this.state.timeoutId);
  }

  render () {
    return this.state.render && (
      <div>
        <FontAwesomeIcon icon={faSpinnerThird} className='fa-spin fa-2x' />
      </div>
    );
  }
}
