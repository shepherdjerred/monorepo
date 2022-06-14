import {connect} from 'react-redux';
import {createClub} from '../../../store/features/clubs/actions';
import CreateClubForm from './Form';
import WithRequest from '../../common/WithRequest';
import {compose} from 'redux';
import {withRouter} from 'react-router-dom';

const mapStateToProps = function (state) {
  return {
    isFetching: state.clubs.create.isFetching,
    error: state.clubs.create.error
  };
};

const mapDispatchToProps = function (dispatch) {
  return {
    onSubmit: (values, e, formApi) => {
      dispatch(createClub(values.name, values.shortName));
    }
  };
};

const enhance = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  ),
  WithRequest,
  withRouter
);

export const CreateClubFormContainer = enhance(CreateClubForm);
