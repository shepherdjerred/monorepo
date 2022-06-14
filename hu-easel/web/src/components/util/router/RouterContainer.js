import {connect} from 'react-redux';
import Navbar from './Router';
import { withRouter } from 'react-router';

const mapStateToProps = function (state) {
  const { isLoggedIn } = state.authentication.jwt;
  return {
    isLoggedIn
  };
};

const RouterContainer = withRouter(connect(
  mapStateToProps
)(Navbar));

export default RouterContainer;
