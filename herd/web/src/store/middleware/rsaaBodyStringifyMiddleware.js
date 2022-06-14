import {isRSAA, RSAA} from 'redux-api-middleware';

export const bodyStringifyMiddleware = store => next => action => {
  if (isRSAA(action)) {
    const actionWithStringifiedBody = {
      ...action,
      [RSAA]: {
        ...action[RSAA],
        body: JSON.stringify(action[RSAA].body)
      }
    };
    return next(actionWithStringifiedBody);
  }
  return next(action);
};
