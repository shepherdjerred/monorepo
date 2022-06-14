import {isRSAA, RSAA} from 'redux-api-middleware';

export const jwtMiddleware = ({getState}) => next => action => {
  if (isRSAA(action)) {
    const jwt = getState().authentication.token.jwt;
    if (jwt) {
      const actionWithJwt = {
        ...action,
        [RSAA]: {
          ...action[RSAA],
          headers: {
            ...action[RSAA].headers,
            'Authorization': 'Bearer ' + jwt
          }
        }
      };
      return next(actionWithJwt);
    }
  }
  return next(action);
};
