import { Form, Text } from 'react-form';
import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { validateUsername, validatePassword } from '../../../validators';
import ErrorNotification from '../../fragments/ErrorNotification';

export default class LoginForm extends Component {
  static propTypes = {
    onRequest: PropTypes.func.isRequired,
    error: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.bool
    ]).isRequired,
    isRequesting: PropTypes.bool.isRequired
  };

  render () {
    let {isRequesting, error, onRequest} = this.props;
    return (
      <div>
        {!isRequesting && error &&
        <ErrorNotification title={error.name} message={error.message}
          stack={error.stack} />}
        <Form onSubmit={onRequest}
          defaultValues={{username: 'admin', password: 'admin'}}>
          {formApi => (
            <form onSubmit={formApi.submitForm}>
              <div className='field'>
                <label className='label'>Username</label>
                <div className='control'>
                  <Text
                    field='username'
                    validate={validateUsername}
                    autoComplete='username' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.username}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Password</label>
                <div className='control'>
                  <Text
                    type='password'
                    field='password'
                    validate={validatePassword}
                    autoComplete='password' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.password}</p>)}
              </div>
              <div className='field'>
                <div className='control'>
                  {isRequesting && <p>Logging in...</p>}
                  <button>Submit</button>
                </div>
              </div>
            </form>
          )}
        </Form>
      </div>
    );
  }
}
