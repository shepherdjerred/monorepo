import {connect} from 'react-redux';
import {compose} from 'redux';
import {login} from '../../../store/authentication/login/actions';
import WithRequest from '../../util/hoc/WithRequest';
import LoginForm from './LoginForm';

const mapStateToProps = function (state) {
  return {
    isRequesting: state.authentication.login.isRequesting,
    error: state.authentication.login.error
  };
};

const mapDispatchToProps = function (dispatch) {
  return {
    onRequest: (values, e, formApi) => {
      dispatch(login(values.username, values.password));
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
