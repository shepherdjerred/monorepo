import {createRsaaReducer} from '../rsaa';

/**
 * Creates reducers for each CRUD action
 * @param actions {{fetchList: {success: string, error: string, begin: string}, fetchDetails: {success: string, error: string, begin: string}, create: {success: string, error: string, begin: string}, update: {success: string, error: string, begin: string}, delete: {success: string, error: string, begin: string}}}
 * @returns {{read: *, create: *, update: *, delete: *}}
 */
export function createCrudReducers (actions) {
  return {
    create: createRsaaReducer(actions.create),
    read: createReadReducer(actions.fetchList, actions.fetchDetails),
    update: createRsaaReducer(actions.update),
    delete: createRsaaReducer(actions.delete)
  };
}

function createReadReducer (fetchListActions, fetchDetailsActions) {
  const initialState = {
    isFetching: false,
    error: false,
    items: {}
  };
  return (state = initialState, action) => {
    switch (action.type) {
      case fetchListActions.begin:
        return {
          ...state,
          isFetching: true,
          error: null
        };
      case fetchListActions.success:
        const response = action.payload;
        const items = response.reduce((list, entry) => {
          list[entry._id] = {
            data: entry
          };
          return list;
        }, {});
        return {
          ...state,
          items,
          isFetching: false,
          error: null
        };
      case fetchListActions.error:
        return {
          ...state,
          isFetching: false,
          error: action.payload
        };
      case fetchDetailsActions.begin:
        return {
          ...state,
          items: {
            ...state.items,
            [action.id]: {
              ...state.items[action.id],
              isFetching: true,
              error: null
            }
          }
        };
      case fetchDetailsActions.success:
        return {
          ...state,
          items: {
            ...state.items,
            [action.payload._id]: {
              ...state.items[action._id],
              data: action.payload,
              isFetching: false,
              error: null
            }
          }
        };
      // TODO this will not work. The ID is not sent in the action
      case fetchDetailsActions.error:
        return {
          ...state,
          items: {
            ...state.items,
            [action.id]: {
              ...state.items[action.id],
              isFetching: false,
              error: action.payload
            }
          }
        };
      default:
        return state;
    }
  };
}
