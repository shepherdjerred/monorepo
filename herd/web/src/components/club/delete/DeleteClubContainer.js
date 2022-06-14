import {connect} from 'react-redux';
import {compose} from 'redux';
import {deleteClub, fetchClubDetails} from '../../../store/features/clubs/actions';
import WithLoading from '../../common/WithLoading';
import WithRequest from '../../common/WithRequest';
import DeleteClub from './DeleteClub';
import {withRouter} from 'react-router-dom';

const loadingMapStateToProps = function (state, props) {
  let {clubId} = props;
  let club = state.clubs.read.items[clubId];
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

const loadingMapDispatchToProps = function (dispatch, props) {
  let {clubId} = props;
  return {
    onFetch: () => {
      dispatch(fetchClubDetails(clubId));
    },
    onRequest: () => {
      dispatch(deleteClub(clubId));
    }
  };
};

const requestMapStateToProps = function (state) {
  return state.clubs.delete;
};

const requestMapDispatchToProps = function (dispatch, props) {
  let {clubId} = props;
  return {
    onRequest: () => {
      dispatch(deleteClub(clubId));
    }
  };
};

const enhance = compose(
  connect(
    loadingMapStateToProps,
    loadingMapDispatchToProps
  ),
  WithLoading,
  connect(
    requestMapStateToProps,
    requestMapDispatchToProps
  ),
  WithRequest,
  withRouter
);

export default enhance(DeleteClub);
