import connect from 'react-redux/es/connect/connect';
import {fetchUserDetailsBegin} from '../../../store/features/users/read/actions';
import WithLoading from '../common/WithLoading';

function WithRedux (WrappedComponent, id) {
  const mapStateToProps = function (state, props) {
    let user = state.user.details.items[id];
    if (user) {
      return {
        user: user.data,
        isFetching: user.isFetching,
        error: user.error
      };
    } else {
      return {
        user: null,
        isFetching: true,
        error: false
      };
    }
  };

  const mapDispatchToProps = function (dispatch, props) {
    return {
      onFetch: () => {
        dispatch(fetchUserDetailsBegin(id));
      }
    };
  };

  return connect(
    mapStateToProps,
    mapDispatchToProps
  )(WrappedComponent);
}

export default function WithUser (id) {
  return function (WrappedComponent) {
    let ComponentWithLoading = WithLoading(WrappedComponent);
    return WithRedux(ComponentWithLoading, id);
  };
}
