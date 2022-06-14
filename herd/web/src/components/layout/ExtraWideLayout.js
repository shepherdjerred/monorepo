import React, {Component} from 'react';
import PropTypes from 'prop-types';
import './Layout.css';

export default class ExtraWideLayout extends Component {
  static propTypes = {
    children: PropTypes.node.isRequired
  };

  render () {
    return (
      <div className='container layout'>
        <div className='columns'>
          <div className='column is-full is-10-mobile is-offset-1-mobile'>
            {this.props.children}
          </div>
        </div>
      </div>
    );
  }
}
