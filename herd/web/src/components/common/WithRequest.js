import PropTypes from 'prop-types';
import React, {Component, Fragment} from 'react';
import ErrorNotification from './errorNotification/ErrorNotification';

function getDisplayName (WrappedComponent) {
  return WrappedComponent.displayName || WrappedComponent.name || 'WithRequest';
}

export default function WithRequest (WrappedComponent) {
  return class WithRequest extends Component {
    static propTypes = {
      isFetching: PropTypes.bool.isRequired,
      error: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.bool
      ]).isRequired,
      onRequest: PropTypes.func
    };

    displayName = getDisplayName(WrappedComponent);

    render () {
      let {isFetching, error} = this.props;
      return (
        <Fragment>
          {!isFetching && error && <ErrorNotification title={error.name} message={error.message} />}
          <WrappedComponent {...this.props} />
        </Fragment>
      );
    }
  };
}
