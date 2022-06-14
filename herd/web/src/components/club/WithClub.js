import connect from 'react-redux/es/connect/connect';
import {fetchClubDetails} from '../../../store/features/clubs/read/actions';
import WithLoading from '../common/WithLoading';

function WithRedux (WrappedComponent, id) {
  const mapStateToProps = function (state, props) {
    let club = state.clubs.read.items[id];
    if (club) {
      return {
        club: club.data,
        isFetching: club.isFetching,
        error: club.error
      };
    } else {
      return {
        club: null,
        isFetching: true,
        error: false
      };
    }
  };

  const mapDispatchToProps = function (dispatch, props) {
    return {
      onFetch: () => {
        dispatch(fetchClubDetails(id));
      }
    };
  };

  return connect(
    mapStateToProps,
    mapDispatchToProps
  )(WrappedComponent);
}

export default function WithClub (id) {
  return function (WrappedComponent) {
    let ComponentWithLoading = WithLoading(WrappedComponent);
    return WithRedux(ComponentWithLoading, id);
  };
}
