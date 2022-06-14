import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import RootRouter from './RootRouter';

const mapStateToProps = (state, ownProps) => {
  return {
    isLoggedIn: state.authentication.token.jwt !== null
  };
};

export const RootRouterContaner = withRouter(connect(
  mapStateToProps
)(RootRouter));
