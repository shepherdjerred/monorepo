import React, {Component} from 'react';
import './RegisterHelpView.css';
import NarrowLayout from '../../layout/NarrowLayout';

export default class RegisterHelpView extends Component {
  render () {
    return (
      <NarrowLayout>
        <div className='content'>
          <h1 className='title is-1 register-help-title'>Registration Help</h1>

          <h2 className='subtitle is-5'>What email address should I use?</h2>
          <p>Your email address should be the same a your Harding email address (i.e. it ends with
                  @harding.edu).</p>

          <h2 className='subtitle is-5'>I'm getting a message saying 'This email has already been
                  registered'</h2>
          <p>Double check that you are entering your email correctly. It is possible someone else has already registered
                  using your Harding email. If you still get the error after checking, email me at <a href='mailto:shepherdjerred@gmail.com'>shepherdjerred@gmail.com</a> with your H number so that I can
                  see if anyone else has created an account with your H number.</p>

          <h2 className='subtitle is-5'>I'm getting a message saying 'This ID number has already been
                  registered'</h2>
          <p>Double check that you are entering your H number correctly. It is possible someone else has already registered
                  using your H number. If you still get the error after checking, email me at <a href='mailto:shepherdjerred@gmail.com'>shepherdjerred@gmail.com</a> with your H number so that I can
                  see if anyone else has created an account with your Harding email.</p>

          <h2 className='subtitle is-5'>Can I create a second account?</h2>
          <p>No. Only one account can exist per student. Please email me at <a
            href='mailto:shepherdjerred@gmail.com'>shepherdjerred@gmail.com</a> if you have a reason for needing a
                  second account.</p>

          <h2 className='subtitle is-5'>Why do you need information like my H number?</h2>
          <p>Your H number allows your club secretary to easily keep a roster of every member in your club.
                  Without collecting your H number here, your secretary would have to collect it some other way.</p>

          <h2 className='subtitle is-5'>I'm having another issue not mentioned above</h2>
          <p>No problem. Just contact me and I can help you out. My email is <a
            href='mailto:shepherdjerred@gmail.com'>shepherdjerred@gmail.com</a>.</p>
        </div>
      </NarrowLayout>
    );
  }
}
