import {
  FETCH_TERM_DETAILS_BEGIN,
  FETCH_TERM_DETAILS_ERROR,
  FETCH_TERM_DETAILS_SUCCESS,
  FETCH_TERM_LIST_BEGIN,
  FETCH_TERM_LIST_ERROR,
  FETCH_TERM_LIST_SUCCESS,
  INVALIDATE_TERM_DETAILS,
  INVALIDATE_TERM_LIST
} from './actions';

let initialState = {
  items: {},
  isFetching: false,
  error: false,
  lastUpdated: null,
  didInvalidate: false
};

export default function readTermReducer (state = initialState, action) {
  let termUuid = action.termUuid;
  switch (action.type) {
    case INVALIDATE_TERM_DETAILS:
      return {
        ...state,
        items: {
          ...state.items,
          [termUuid]: {
            ...state.items[termUuid],
            didInvalidate: true
          }
        }
      };
    case FETCH_TERM_DETAILS_BEGIN:
      return {
        ...state,
        items: {
          ...state.items,
          [termUuid]: {
            ...state.items[termUuid],
            isFetching: true,
            error: false,
            didInvalidate: false
          }
        }
      };
    case FETCH_TERM_DETAILS_SUCCESS:
      return {
        ...state,
        items: {
          ...state.items,
          [termUuid]: {
            ...state.items[termUuid],
            data: action.term,
            isFetching: false,
            error: false,
            lastUpdated: action.receivedAt,
            didInvalidate: false
          }
        }
      };
    case FETCH_TERM_DETAILS_ERROR:
      return {
        ...state,
        items: {
          ...state.items,
          [termUuid]: {
            ...state.items[termUuid],
            isFetching: false,
            error: action.error,
            lastUpdated: action.receivedAt,
            didInvalidate: false
          }
        }
      };
    case INVALIDATE_TERM_LIST:
      return {
        ...state,
        didInvalidate: true
      };
    case FETCH_TERM_LIST_BEGIN:
      return {
        ...state,
        isFetching: true,
        error: false,
        didInvalidate: false
      };
    case FETCH_TERM_LIST_SUCCESS:
      return {
        ...state,
        items: action.terms,
        isFetching: false,
        error: false,
        lastUpdated: action.receivedAt,
        didInvalidate: false
      };
    case FETCH_TERM_LIST_ERROR:
      return {
        ...state,
        isFetching: false,
        error: action.error,
        lastUpdated: action.receivedAt,
        didInvalidate: false
      };
    default:
      return state;
  }
}
