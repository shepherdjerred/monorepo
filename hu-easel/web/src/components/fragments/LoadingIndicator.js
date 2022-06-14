import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class LoadingIndicator extends Component {
  state = {
    render: false,
    timeoutId: null
  };

  static propTypes = {
    delay: PropTypes.number
  };

  static defaultProps = {
    delay: 250
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
        <p>Loading</p>
      </div>
    );
  }
}
