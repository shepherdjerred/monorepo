import * as api from '../../../api';
const { terms } = api.default;

export const FETCH_TERM_LIST_BEGIN = 'FETCH_TERM_LIST_BEGIN';
export const FETCH_TERM_LIST_SUCCESS = 'FETCH_TERM_LIST_SUCCESS';
export const FETCH_TERM_LIST_ERROR = 'FETCH_TERM_LIST_ERROR';
export const INVALIDATE_TERM_LIST = 'INVALIDATE_TERM_LIST';

export const FETCH_TERM_DETAILS_BEGIN = 'FETCH_TERM_DETAILS_BEGIN';
export const FETCH_TERM_DETAILS_SUCCESS = 'FETCH_TERM_DETAILS_SUCCESS';
export const FETCH_TERM_DETAILS_ERROR = 'FETCH_TERM_DETAILS_ERROR';
export const INVALIDATE_TERM_DETAILS = 'INVALIDATE_TERM_DETAILS';

export function fetchTermDetails (termUuid) {
  return function (dispatch, getState) {
    let jwt = getState().authentication.jwt.token;
    (async function () {
      dispatch(fetchTermDetailsBegin(termUuid));
      try {
        let term = await terms.readTerm(jwt, termUuid);
        dispatch(fetchTermDetailsSuccess(termUuid, term));
      } catch (err) {
        dispatch(fetchTermDetailsError(termUuid, err));
      }
    })();
  };
}

export function fetchTermDetailsBegin (termUuid) {
  return {
    type: FETCH_TERM_DETAILS_BEGIN,
    termId: termUuid
  };
}

export function fetchTermDetailsSuccess (termUuid, term) {
  return {
    type: FETCH_TERM_DETAILS_SUCCESS,
    termUuid,
    term,
    receivedAt: Date.now()
  };
}

export function fetchTermDetailsError (termId, error) {
  return {
    type: FETCH_TERM_DETAILS_ERROR,
    termId,
    error
  };
}

export function fetchTermList () {
  return function (dispatch, getState) {
    let jwt = getState().authentication.jwt.token;
    (async function () {
      dispatch(fetchTermListBegin());
      try {
        let fetchedTerms = await terms.readTerms(jwt);
        dispatch(fetchTermListSuccess(fetchedTerms));
      } catch (err) {
        dispatch(fetchTermListError(err));
      }
    })();
  };
}

export function fetchTermListBegin () {
  return {
    type: FETCH_TERM_LIST_BEGIN
  };
}

export function fetchTermListSuccess (termsArray) {
  let terms = termsArray.reduce((terms, term) => {
    terms[term.uuid] = {
      data: term
    };
    return terms;
  }, {});

  return {
    type: FETCH_TERM_LIST_SUCCESS,
    terms,
    receivedAt: Date.now()
  };
}

export function fetchTermListError (error) {
  return {
    type: FETCH_TERM_LIST_ERROR,
    error
  };
}
