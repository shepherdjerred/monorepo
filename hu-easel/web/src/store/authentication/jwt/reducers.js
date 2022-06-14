import {REMOVE_JWT, SET_JWT} from './actions';

const initialState = {
  token: '',
  decoded: {
    username: ''
  },
  isLoggedIn: false
};

export default function jwtReducer (state = initialState, action) {
  switch (action.type) {
    case SET_JWT:
      return {
        ...state,
        token: action.token,
        decoded: action.decoded,
        isLoggedIn: true
      };
    case REMOVE_JWT:
      return {
        ...state,
        token: action.token,
        decoded: action.decoded,
        isLoggedIn: false
      };
    default:
      return state;
  }
}
