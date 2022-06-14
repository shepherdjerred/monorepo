import {connect} from 'react-redux';
import { setJwt } from '../../../store/authentication/jwt/actions';
import Navbar from './Navbar';

const mapStateToProps = function (state) {
  const { isLoggedIn, decoded } = state.authentication.jwt;
  return {
    isLoggedIn,
    username: decoded.username
  };
};

const mapDispatchToProps = function (dispatch) {
  return {
    onLogout: (values, e, formApi) => {
      dispatch(setJwt(null));
    }
  };
};

const NavbarContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Navbar);

export default NavbarContainer;
