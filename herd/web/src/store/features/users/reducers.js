import {combineReducers} from 'redux';
import {createCrudReducers} from '../../utils/crud/reducers';
import {actionTypes} from './actions';

const reducers = createCrudReducers(actionTypes);

export const usersReducer = combineReducers({
  create: reducers.create,
  delete: reducers.delete,
  read: reducers.read,
  update: reducers.update
});
