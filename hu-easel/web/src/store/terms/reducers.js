import { combineReducers } from 'redux';
import createTermReducer from './create/reducers';
import readTermReducer from './read/reducers';

export const termReducer = combineReducers({
  create: createTermReducer,
  read: readTermReducer
});
