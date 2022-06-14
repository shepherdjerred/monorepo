import jwtDecode from 'jwt-decode';
import {REMOVE_JWT, loginActionTypes} from './actions';

const {begin, success, error} = loginActionTypes;

const initialState = {
  isFetching: false,
  error: false,
  token: {
    jwt: null,
    decodedJwt: null
  }
};

export function authenticationReducer (state = initialState, action) {
  switch (action.type) {
    case REMOVE_JWT:
      return {
        ...state,
        token: initialState.token
      };
    case begin:
      return {
        ...state,
        isFetching: true,
        error: false
      };
    case success:
      const {token} = action.payload;
      const decodedJwt = jwtDecode(token);
      return {
        ...state,
        isFetching: false,
        error: false,
        token: {
          jwt: token,
          decodedJwt
        }
      };
    case error:
      return {
        ...state,
        isFetching: false,
        error: action.payload
      };
    default:
      return state;
  }
}
