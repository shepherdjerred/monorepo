import {createCrudActionCreators, createCrudActionTypes} from '../../utils/crud/actions';

export const actionTypes = createCrudActionTypes('CLUB');
const actions = createCrudActionCreators('CLUB', '/api/clubs/', actionTypes);

export function createClub (name, shortName) {
  return actions.create({name, shortName});
}

export function fetchClubList () {
  return actions.fetchList();
}

export function fetchClubDetails (id) {
  return actions.fetchDetails(id);
}

export function updateClub (id, name, shortName) {
  return actions.update(id, {name, shortName});
}

export function deleteClub (id) {
  return actions.delete(id);
}
