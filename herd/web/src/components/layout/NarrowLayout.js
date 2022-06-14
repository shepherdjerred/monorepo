import React, {Component} from 'react';
import PropTypes from 'prop-types';
import './Layout.css';

export default class NarrowLayout extends Component {
  static propTypes = {
    children: PropTypes.node.isRequired
  };

  render () {
    return (
      <div className='container layout'>
        <div className='columns'>
          <div className='column is-one-third is-offset-one-third is-10-mobile is-offset-1-mobile'>
            {this.props.children}
          </div>
        </div>
      </div>
    );
  }
}
