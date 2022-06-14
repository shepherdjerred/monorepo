import {createCrudActionCreators, createCrudActionTypes} from '../../utils/crud/actions';

export const actionTypes = createCrudActionTypes('USER');
const actions = createCrudActionCreators('USER', '/api/users/', actionTypes);

export function registerUser (firstName, lastName, email, hNumber, password) {
  return actions.create({firstName, lastName, email, hNumber, password, register: true});
}

export function createUser () {
  // TODO
}
