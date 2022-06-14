import {combineReducers} from 'redux';
import jwtReducer from './jwt/reducers';
import loginReducer from './login/reducers';

export const authenticationReducer = combineReducers({
  login: loginReducer,
  jwt: jwtReducer
});
