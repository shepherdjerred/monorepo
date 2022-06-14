import {connect} from 'react-redux';
import {compose} from 'redux';
import {login} from '../../../store/features/authentication/actions';
import WithRequest from '../../common/WithRequest';
import LoginForm from './LoginForm';

const mapStateToProps = function (state) {
  return {
    isRequesting: state.authentication.isFetching,
    error: state.authentication.error
  };
};

const mapDispatchToProps = function (dispatch) {
  return {
    onRequest: (values, e, formApi) => {
      dispatch(login(values.email, values.password));
    }
  };
};

const enhance = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  ),
  WithRequest
);

export default enhance(LoginForm);
