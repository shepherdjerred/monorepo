import {isRSAA, RSAA} from 'redux-api-middleware';

export const contentTypeMiddleware = store => next => action => {
  if (isRSAA(action)) {
    const actionWithContentType = {
      ...action,
      [RSAA]: {
        ...action[RSAA],
        headers: {
          ...action[RSAA].headers,
          'Content-Type': 'application/json'
        }
      }
    };
    return next(actionWithContentType);
  }
  return next(action);
};
