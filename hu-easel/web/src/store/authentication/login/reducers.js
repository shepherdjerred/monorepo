import {REQUEST_LOGIN_BEGIN, REQUEST_LOGIN_ERROR, REQUEST_LOGIN_SUCCESS} from './actions';

const initialState = {
  isRequesting: false,
  error: false
};

export default function loginReducer (state = initialState, action) {
  switch (action.type) {
    case REQUEST_LOGIN_BEGIN:
      return {
        ...state,
        isRequesting: true,
        error: false
      };
    case REQUEST_LOGIN_SUCCESS:
      return {
        ...state,
        isRequesting: false,
        error: false
      };
    case REQUEST_LOGIN_ERROR:
      return {
        ...state,
        isRequesting: false,
        error: action.error
      };
    default:
      return state;
  }
}
