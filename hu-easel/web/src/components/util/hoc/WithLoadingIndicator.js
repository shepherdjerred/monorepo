import PropTypes from 'prop-types';
import React, {Component} from 'react';
import ErrorNotification from '../../fragments/ErrorNotification';
import LoadingIndicator from '../../fragments/LoadingIndicator';

export default function WithLoadingIndicator (WrappedComponent) {
  return class extends Component {
    static propTypes = {
      isFetching: PropTypes.bool.isRequired,
      error: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.bool
      ]).isRequired,
      onFetch: PropTypes.func.isRequired
    };

    loadData = () => {
      this.props.onFetch();
    };

    componentDidMount () {
      this.loadData();
    }

    render () {
      let {isFetching, error, ...props} = this.props;
      if (isFetching) {
        return <LoadingIndicator />;
      } else if (error) {
        return <ErrorNotification title={error.name} message={error.message} />;
      } else {
        return <WrappedComponent {...props} />;
      }
    }
  };
}
