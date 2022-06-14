import {REQUEST_CREATE_TERM_BEGIN, REQUEST_CREATE_TERM_ERROR, REQUEST_CREATE_TERM_SUCCESS} from './actions';

let initialState = {
  isRequesting: false,
  error: false
};

export default function createTermReducer (state = initialState, action) {
  switch (action.type) {
    case REQUEST_CREATE_TERM_BEGIN:
      return {
        isRequesting: true,
        error: false
      };
    case REQUEST_CREATE_TERM_SUCCESS:
      return {
        isRequesting: false,
        error: false
      };
    case REQUEST_CREATE_TERM_ERROR:
      return {
        isRequesting: false,
        error: action.error
      };
    default:
      return state;
  }
}
