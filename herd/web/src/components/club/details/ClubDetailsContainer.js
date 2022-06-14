import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {compose} from 'redux';
import {fetchClubDetails} from '../../../store/features/clubs/actions';
import WithLoading from '../../common/WithLoading';
import ClubDetails from './ClubDetails';

const mapStateToProps = function (state, ownProps) {
  let club = state.clubs.read.items[ownProps.clubId];
  if (club) {
    let {data, isFetching, error} = club;
    return {
      club: data,
      isFetching: isFetching !== undefined ? isFetching : true,
      error: error !== undefined ? isFetching : false
    };
  } else {
    return {
      club: null,
      isFetching: true,
      error: false
    };
  }
};

const mapDispatchToProps = function (dispatch, ownProps) {
  return {
    onFetch: () => {
      dispatch(fetchClubDetails(ownProps.clubId));
    }
  };
};

let enhance = compose(
  withRouter,
  connect(
    mapStateToProps,
    mapDispatchToProps
  ),
  WithLoading
);

export default enhance(ClubDetails);
