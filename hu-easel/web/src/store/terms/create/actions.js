import * as api from '../../../api';
const { terms } = api.default;

export const REQUEST_CREATE_TERM_BEGIN = 'REQUEST_CREATE_TERM_BEGIN';
export const REQUEST_CREATE_TERM_SUCCESS = 'REQUEST_CREATE_TERM_SUCCESS';
export const REQUEST_CREATE_TERM_ERROR = 'REQUEST_CREATE_TERM_ERROR';

export function requestCreateTerm (type, startDate, endDate) {
  return function (dispatch, getState) {
    let jwt = getState().authentication.jwt.token;
    (async function () {
      dispatch(createTermBegin());
      try {
        await terms.createTerm(jwt, type, startDate, endDate);
        dispatch(createTermSuccess());
      } catch (err) {
        dispatch(createTermError(err));
      }
    })();
  };
}

export function createTermBegin () {
  return {
    type: REQUEST_CREATE_TERM_BEGIN
  };
}

export function createTermSuccess () {
  return {
    type: REQUEST_CREATE_TERM_SUCCESS
  };
}

export function createTermError (json) {
  return {
    type: REQUEST_CREATE_TERM_ERROR,
    error: json
  };
}
