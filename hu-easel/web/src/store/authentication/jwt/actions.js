import jwtDecode from 'jwt-decode';

export const SET_JWT = 'SET_JWT';
export const REMOVE_JWT = 'REMOVE_JWT';

export function setJwt (jwt) {
  let decoded = jwtDecode(jwt);
  return {
    type: SET_JWT,
    token: jwt,
    decoded
  };
}

export function removeJwt () {
  return {
    type: REMOVE_JWT
  };
}
