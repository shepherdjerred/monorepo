import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Form, Select, Text } from 'react-form';
import ErrorNotification from '../../../../fragments/ErrorNotification';
import { Redirect } from 'react-router';

const termTypes = [
  {
    label: 'Fall',
    value: 0
  },
  {
    label: 'Spring',
    value: 1
  },
  {
    label: 'Summer One',
    value: 2
  },
  {
    label: 'Summer Two',
    value: 3
  },
  {
    label: 'Intersession One',
    value: 4
  },
  {
    label: 'Intersession Two',
    value: 5
  }
];

export default class CreateTermForm extends Component {
  static propTypes = {
    onSubmit: PropTypes.func.isRequired,
    error: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.bool
    ]).isRequired,
    isRequesting: PropTypes.bool,
    history: PropTypes.object
  };

  constructor (props) {
    super(props);
    this.state = {
      hasBeenSubmitted: false
    };
  }

  onCancel = () => {
    this.props.history.goBack();
  };

  onSubmit = (values) => {
    this.props.onSubmit(values);
    this.setState({
      hasBeenSubmitted: true
    });
  };

  render () {
    const {hasBeenSubmitted} = this.state;
    const {isRequesting, error} = this.props;

    if (hasBeenSubmitted && !isRequesting && !error) {
      return (<Redirect to='/terms' />);
    } else {
      return (
        <div>
          {!isRequesting && error &&
          <ErrorNotification title={error.name} message={error.message} stack={error.stack} />}
          <Form
            onSubmit={(values => this.onSubmit(values))}
            defaultValues={{
              type: 0,
              startDate: new Date().getTime(),
              endDate: new Date().getTime()
            }}>
            {formApi => (
              <form
                onSubmit={formApi.submitForm}>
                <div>
                  <label>Type</label>
                  <Select
                    field='type'
                    options={termTypes} />
                  {formApi.errors && (<p>{formApi.errors.type}</p>)}
                </div>
                <div>
                  <label>Start Date</label>
                  <Text field='startDate' />
                  {formApi.errors && (<p>{formApi.errors.startDate}</p>)}
                </div>
                <div>
                  <label>End Date</label>
                  <Text field='endDate' />
                  {formApi.errors && (<p>{formApi.errors.endDate}</p>)}
                </div>
                <div>
                  <button>Submit</button>
                  <a onClick={this.onCancel}>Cancel</a>
                </div>
              </form>
            )}
          </Form>
        </div>
      );
    }
  }
}
