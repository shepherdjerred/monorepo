import React, {Component} from 'react';
import NarrowLayout from '../../layout/NarrowLayout';
import LoginFormContainer from './LoginFormContainer';

export default class LoginView extends Component {
  render () {
    return (
      <NarrowLayout>
        <LoginFormContainer />
      </NarrowLayout>
    );
  }
}
