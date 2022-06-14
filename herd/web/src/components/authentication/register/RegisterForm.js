import * as classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Form, Text} from 'react-form';
import {Link} from 'react-router-dom';
import {
  validateRegistration
} from '../../../validation/userValidators';
import ErrorNotification from '../../common/errorNotification/ErrorNotification';
import {
  validateEmail, validateFirstName,
  validateHNumber,
  validateLastName,
  validatePassword
} from '../../../validation/userValidators';

class RegisterForm extends Component {
  render () {
    let {isRequesting, error, onRequest} = this.props;
    return (
      <div>
        <h1 className='title is-1'>Register</h1>
        {!isRequesting && error && <ErrorNotification title={error.name} message={error.message} stack={error.stack} />}
        <Form onSubmit={onRequest}
          validate={validateRegistration}>
          {formApi => (
            <form onSubmit={formApi.submitForm}>
              <div className='field'>
                <label className='label'>First Name</label>
                <div className='control'>
                  <Text
                    placeholder='John'
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.firstName})}
                    field='firstName'
                    validate={validateFirstName}
                    autoComplete='given-name' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.firstName}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Last Name</label>
                <div className='control'>
                  <Text
                    placeholder='Doe'
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.lastName})}
                    field='lastName'
                    validate={validateLastName}
                    autoComplete='family-name' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.lastName}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Harding Email</label>
                <div className='control'>
                  <Text
                    placeholder='jdoe@harding.edu'
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.email})}
                    field='email'
                    validate={validateEmail}
                    autoComplete='email' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.email}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Harding ID Number</label>
                <div className='control'>
                  <Text
                    placeholder='H0123456'
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.hNumber})}
                    field='hNumber'
                    validate={validateHNumber}
                    autoComplete='off' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.hNumber}</p>)}
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
                    autoComplete='new-password' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.password}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Confirm Password</label>
                <div className='control'>
                  <Text
                    className={classNames({
                      input: true,
                      'is-danger': formApi.errors && formApi.errors.confirmPassword
                    })}
                    type='password'
                    field='confirmPassword'
                    autoComplete='new-password' />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.confirmPassword}</p>)}
              </div>
              <div className='field'>
                <div className='control'>
                  <button className={classNames({'button': true, 'is-link': true, 'is-loading': isRequesting})}>Submit
                  </button>
                </div>
              </div>
              <div className='field is-grouped'>
                <div className='control'>
                  <Link className='button is-text' to='/login'>Already have an account?</Link>
                </div>
                <div className='control'>
                  <Link className='button is-text' to='/register/help'>Trouble registering?</Link>
                </div>
              </div>
            </form>
          )}
        </Form>
      </div>
    );
  }
}

RegisterForm.propTypes = {
  onRequest: PropTypes.func.isRequired,
  error: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.bool
  ]).isRequired,
  isRequesting: PropTypes.bool.isRequired
};

export default RegisterForm;
