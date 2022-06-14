import {combineReducers} from 'redux';
import navbarReducer from './navbar/reducers';

export const interfaceReducer = combineReducers({
  navbar: navbarReducer
});
