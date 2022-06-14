import { fetchApi } from './index';

export async function createTerm (jwt, type, startDate, endDate) {
  return fetchApi('/api/terms', {
    method: 'POST',
    jwt,
    body: {
      type,
      startDate,
      endDate
    }
  });
}

export async function readTerms (jwt) {
  return fetchApi('/api/terms', {
    jwt
  });
}

export async function readTerm (jwt, termUuid) {
  return fetchApi('/api/terms/' + termUuid, {
    jwt
  });
}
