import * as classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Form, Text} from 'react-form';
import {Redirect} from 'react-router-dom';
import { withRouter } from 'react-router';
import {validateClubName} from '../../../validation/clubValidators';
import ErrorNotification from '../../common/errorNotification/ErrorNotification';
import { validateClubShortName } from '../../../validation/clubValidators';

class EditClub extends Component {
  state = {
    hasBeenSubmitted: false
  };

  static propTypes = {
    club: PropTypes.object.isRequired,
    isFetching: PropTypes.bool,
    error: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.bool
    ]).isRequired,
    onSave: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired
  };

  onCancel = () => {
    this.props.history.goBack();
  };

  render () {
    let club = this.props.club;
    if (this.state.hasBeenSubmitted && !this.props.isFetching && !this.props.error) {
      return (<Redirect to='/club/list' />);
    }
    return (
      <div>
        <h1 className='title is-1'>Edit {club.name}</h1>
        {!this.props.isFetching && this.props.error && <ErrorNotification title={this.props.error.name} message={this.props.error.message} stack={this.props.error.stack} />}
        <Form onSubmit={(values) => this.props.onSave(values)}
          defaultValues={{name: club.name, shortName: club.shortName}}>
          {formApi => (
            <form onSubmit={formApi.submitForm}>
              <div className='field'>
                <label className='label'>Name</label>
                <div className='control'>
                  <Text
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.name})}
                    field='name'
                    validate={validateClubName} />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.name}</p>)}
              </div>
              <div className='field'>
                <label className='label'>Short Name</label>
                <div className='control'>
                  <Text
                    className={classNames({input: true, 'is-danger': formApi.errors && formApi.errors.shortName})}
                    field='shortName'
                    validate={validateClubShortName} />
                </div>
                {formApi.errors && (<p className='help is-danger'>{formApi.errors.shortName}</p>)}
              </div>
              <div className='field is-grouped'>
                <p className='control'>
                  <button className='button is-primary'>Submit</button>
                </p>
                <p className='control'>
                  <a className='button is-danger' onClick={this.onCancel}>Cancel</a>
                </p>
              </div>
            </form>
          )}
        </Form>
      </div>
    );
  }
}

export default withRouter(EditClub);
