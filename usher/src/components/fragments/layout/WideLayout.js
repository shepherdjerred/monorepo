import React, {Component} from 'react';
import PropTypes from 'prop-types';

export default class WideLayout extends Component {
  static propTypes = {
    children: PropTypes.node.isRequired
  };

  render () {
    return (
      <div>
        <section className='section'>
          <div className='container'>
            <div className='columns'>
              <div className='column is-three-fifths is-offset-one-fifth'>
                {this.props.children}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }
}
