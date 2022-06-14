import {combineReducers} from 'redux';
import {authenticationReducer} from './authentication/reducers';
import {termReducer} from './terms/reducers';

export function rootReducer (state = {}, action) {
  return combineReducers({
    authentication: authenticationReducer,
    terms: termReducer
  });
}
