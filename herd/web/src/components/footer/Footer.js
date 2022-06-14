import React, {Component} from 'react';

export default class Footer extends Component {
  render () {
    return (
      <footer className='footer'>
        <div className='container'>
          <div className='content has-text-centered'>
            <p>
              <strong>Herd</strong> by <a href='https://shepherdjerred.com/'>Jerred Shepherd</a>.
              <br />
              <a href='mailto:shepherdjerred@gmail.com'>Contact Me</a>
            </p>
          </div>
        </div>
      </footer>
    );
  }
}
