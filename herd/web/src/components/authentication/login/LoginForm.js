import * as classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Form, Text} from 'react-form';
import {Link} from 'react-router-dom';
import {validateEmail, validatePassword} from '../../../validation/userValidators';
import ErrorNotification from '../../common/errorNotification/ErrorNotification';

class LoginForm extends Component {
  render () {
    let {isRequesting, error, onRequest} = this.props;
    return (
      <div>
        <h1 className='title is-1'>Login</h1>
        {!isRequesting && error &&
        <ErrorNotification title={error.name} message={error.message}
          stack={error.stack} />}
        <Form onSubmit={onRequest}
          defaultValues={{email: 'jshepherd@harding.edu', password: 'mypassword'}}>
          {formApi => (
            <form onSubmit={formApi.submitForm}>
              <div className='field'>
                <label className='label'>Harding Email</label>
                <div className='control'>
                  <Text
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.email})}
                    field='email'
                    validate={validateEmail}
                    autoComplete='username' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.email}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Password</label>
                <div className='control'>
                  <Text
                    className={classNames({
                      input: true,
                      'is-danger': formApi.errors && formApi.errors.password
                    })}
                    type='password'
                    field='password'
                    validate={validatePassword}
                    autoComplete='password' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.password}</p>)}
              </div>
              <div className='field'>
                <div className='control'>
                  <button className={classNames({'button': true, 'is-link': true, 'is-loading': isRequesting})}>Submit
                  </button>
                </div>
              </div>
              <div className='field is-grouped'>
                <div className='control'>
                  <Link className='button is-text'
                    to='/register'>Don't have an account?</Link>
                </div>
                <div className='control'>
                  <Link className='button is-text'
                    to='/login/help'>Trouble logging in?</Link>
                </div>
              </div>
            </form>
          )}
        </Form>
      </div>
    );
  }
}

LoginForm.propTypes = {
  onRequest: PropTypes.func.isRequired,
  error: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.bool
  ]).isRequired,
  isRequesting: PropTypes.bool.isRequired
};

export default LoginForm;
