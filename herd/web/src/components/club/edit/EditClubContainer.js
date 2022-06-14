import {connect} from 'react-redux';
import {updateClub, fetchClubDetails} from '../../../store/features/clubs/actions';
import LoadingEditClub from './LoadingEditClub';

export const mapStateToProps = function (state, props) {
  // TODO this is a little hacky
  let club = state.clubs.read.items[props.id];
  if (club) {
    return {
      club: state.clubs.read.items[props.id].data,
      isFetching: state.clubs.read.items[props.id].isFetching,
      error: state.clubs.read.items[props.id].error,
      isEditFetching: state.clubs.update.isFetching,
      isEditError: state.clubs.update.error
    };
  } else {
    return {
      club: null,
      isFetching: true,
      error: false,
      isEditFetching: false,
      isEditError: null
    };
  }
};

const mapDispatchToProps = function (dispatch, props) {
  return {
    onFetchClub: () => {
      dispatch(fetchClubDetails(props.id));
    },
    onSave: (club) => {
      dispatch(updateClub(club));
    }
  };
};

let EditClubContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(LoadingEditClub);

export default EditClubContainer;
