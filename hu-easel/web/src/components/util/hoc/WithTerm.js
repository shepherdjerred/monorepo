import connect from 'react-redux/es/connect/connect';
import {fetchTermDetails} from '../../../store/terms/read/actions';
import WithLoadingIndicator from './WithLoadingIndicator';

function WithRedux (WrappedComponent, id) {
  const mapStateToProps = function (state, props) {
    let term = state.terms.read.items[id];
    if (term) {
      return {
        term: term.data,
        isFetching: term.isFetching,
        error: term.error
      };
    } else {
      return {
        term: null,
        isFetching: true,
        error: false
      };
    }
  };

  const mapDispatchToProps = function (dispatch, props) {
    return {
      onFetch: () => {
        dispatch(fetchTermDetails(id));
      }
    };
  };

  return connect(
    mapStateToProps,
    mapDispatchToProps
  )(WrappedComponent);
}

export default function WithTerm (id) {
  return function (WrappedComponent) {
    let ComponentWithLoading = WithLoadingIndicator(WrappedComponent);
    return WithRedux(ComponentWithLoading, id);
  };
}
