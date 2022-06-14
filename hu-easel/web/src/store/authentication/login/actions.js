import api from '../../../api';
import {setJwt} from '../jwt/actions';

export const REQUEST_LOGIN_BEGIN = 'REQUEST_LOGIN_BEGIN';
export const REQUEST_LOGIN_SUCCESS = 'REQUEST_LOGIN_SUCCESS';
export const REQUEST_LOGIN_ERROR = 'REQUEST_LOGIN_ERROR';

export function login (username, password) {
  return function (dispatch) {
    (async function () {
      dispatch(loginBegin());
      try {
        let json = await api.authentication.login(username, password);
        let token = json.token;
        dispatch(loginSuccess());
        dispatch(setJwt(token));
      } catch (err) {
        dispatch(loginError(err));
      }
    })();
  };
}

export function loginBegin () {
  return {
    type: REQUEST_LOGIN_BEGIN
  };
}

export function loginSuccess () {
  return {
    type: REQUEST_LOGIN_SUCCESS
  };
}

export function loginError (error) {
  return {
    type: REQUEST_LOGIN_ERROR,
    error
  };
}
