import React, {Component} from 'react';
import PropTypes from 'prop-types';
import './Layout.css';

export default class WideLayout extends Component {
  static propTypes = {
    children: PropTypes.node.isRequired
  };

  render () {
    return (
      <div className='container layout'>
        <div className='columns'>
          <div className='column is-three-fifths is-offset-one-fifth is-10-mobile is-offset-1-mobile'>
            {this.props.children}
          </div>
        </div>
      </div>
    );
  }
}
