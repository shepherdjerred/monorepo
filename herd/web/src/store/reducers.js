import {combineReducers} from 'redux';
import {authenticationReducer} from './features/authentication/reducers';
import {clubsReducer} from './features/clubs/reducers';
import {usersReducer} from './features/users/reducers';
import {interfaceReducer} from './features/interface/reducers';

export const rootReducer = combineReducers({
  authentication: authenticationReducer,
  clubs: clubsReducer,
  users: usersReducer,
  interface: interfaceReducer
});
