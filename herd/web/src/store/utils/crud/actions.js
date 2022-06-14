import {RSAA} from 'redux-api-middleware';
import {actionTypesToRsaaArray, createRsaaActionTypes} from '../rsaa';

/**
 * Creates an action type for each CRUD operation
 * @param resource {string} The name of the resource
 * @returns {{fetchList: {success: string, error: string, begin: string}, fetchDetails: {success: string, error: string, begin: string}, create: {success: string, error: string, begin: string}, update: {success: string, error: string, begin: string}, delete: {success: string, error: string, begin: string}}}
 */
export function createCrudActionTypes (resource) {
  return {
    create: createRsaaActionTypes('CREATE_' + resource),
    fetchList: createRsaaActionTypes(resource + '_LIST'),
    fetchDetails: createRsaaActionTypes(resource + '_DETAILS'),
    update: createRsaaActionTypes('UPDATE_' + resource),
    delete: createRsaaActionTypes('DELETE' + resource)
  };
}

/**
 * Creates an action creator for each CRUD operation
 * @param resource {string} The name of the resource
 * @param endpoint {string} The API endpoint to use when making requests
 * @param actionTypes {{fetchList: {success: string, error: string, begin: string}, fetchDetails: {success: string, error: string, begin: string}, create: {success: string, error: string, begin: string}, update: {success: string, error: string, begin: string}, delete: {success: string, error: string, begin: string}}}
 * @returns {{fetchList: *, fetchDetails: *, create: *, update: *, delete: *}}
 */
export function createCrudActionCreators (resource, endpoint, actionTypes) {
  const actionTypesAsRsaaArrays = {};
  for (let action in actionTypes) {
    actionTypesAsRsaaArrays[action] = actionTypesToRsaaArray(actionTypes[action]);
  }
  return {
    create: createCreateActionCreator(endpoint, actionTypesAsRsaaArrays.create),
    fetchList: createFetchListActionCreator(endpoint, actionTypesAsRsaaArrays.fetchList),
    fetchDetails: createFetchDetailsActionCreator(endpoint, actionTypesAsRsaaArrays.fetchDetails),
    update: createUpdateActionCreator(endpoint, actionTypesAsRsaaArrays.update),
    delete: createDeleteActionCreator(endpoint, actionTypesAsRsaaArrays.delete)
  };
}

function createCreateActionCreator (endpoint, actionTypes) {
  return (attributes) => {
    return {
      [RSAA]: {
        endpoint,
        method: 'POST',
        body: {
          ...attributes
        },
        types: actionTypes
      }
    };
  };
}

function createFetchListActionCreator (endpoint, actionTypes) {
  return () => {
    return {
      [RSAA]: {
        endpoint,
        method: 'GET',
        types: actionTypes
      }
    };
  };
}

function createFetchDetailsActionCreator (endpoint, actionTypes) {
  return (id) => {
    return {
      [RSAA]: {
        endpoint: endpoint + id,
        method: 'GET',
        types: actionTypes
      }
    };
  };
}

function createUpdateActionCreator (endpoint, actionTypes) {
  return (id, attributes) => {
    return {
      [RSAA]: {
        endpoint: endpoint + id,
        method: 'PATCH',
        body: {
          ...attributes
        },
        types: actionTypesToRsaaArray(actionTypes.update)
      }
    };
  };
}

function createDeleteActionCreator (endpoint, actionTypes) {
  return (id) => {
    return {
      [RSAA]: {
        endpoint: endpoint + id,
        method: 'DELETE',
        types: actionTypesToRsaaArray(actionTypes.delete)
      }
    };
  };
}
