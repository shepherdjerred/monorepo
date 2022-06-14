/**
 * This method takes the name of an action and create types suitable for an RSAA action creator
 * @param action The name of the action that is being performed
 * @returns {{success: string, error: string, begin: string}}
 */
export function createRsaaActionTypes (action) {
  return {
    begin: 'FETCH_' + action + '_BEGIN',
    success: 'FETCH_' + action + '_SUCCESS',
    error: 'FETCH_' + action + '_ERROR'
  };
}

/**
 * This method takes an object with a begin, success, and error property and returns an array of those properties
 * @param types An object with a begin, success, and error property
 * @returns {*[]} An array of RSAA action types
 */
export function actionTypesToRsaaArray (types) {
  return [types.begin, types.success, types.error];
}

/**
 * Creates a reducer for basic RSAA requests (i.e. requests which only care about fetching and error status)
 * @param actions {{success: string, error: string, begin: string}}
 * @returns {Function}
 */
export function createRsaaReducer (actions) {
  const initialState = {
    isFetching: false,
    error: false
  };
  return (state = initialState, action) => {
    switch (action) {
      case actions.begin:
        return {
          ...state,
          isFetching: true,
          error: null
        };
      case actions.success:
        return {
          ...state,
          isFetching: false,
          error: null
        };
      case actions.error:
        return {
          ...state,
          isFetching: false,
          error: action.payload
        };
      default:
        return state;
    }
  };
}
