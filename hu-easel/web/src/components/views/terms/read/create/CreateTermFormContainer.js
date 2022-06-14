import {connect} from 'react-redux';
import {requestCreateTerm} from '../../../../../store/terms/create/actions';
import CreateTerm from './CreateTermForm';

const mapStateToProps = function (state) {
  return {
    isFetching: state.terms.create.isFetching,
    error: state.terms.create.error
  };
};

const mapDispatchToProps = function (dispatch) {
  return {
    onSubmit: (values, e, formApi) => {
      dispatch(requestCreateTerm(values.type, values.startDate, values.endDate));
    }
  };
};

const CreateTermFormContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(CreateTerm);

export default CreateTermFormContainer;
