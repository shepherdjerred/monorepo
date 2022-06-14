import * as authentication from './authentication';
import * as terms from './terms';
import fetch from 'cross-fetch';

export const API_URL = process.env.REACT_APP_API_URL;

export default {
  authentication,
  terms
};

export async function processResponse (res) {
  const json = await res.json();

  if (!res.ok) {
    let err = new Error();
    err.name = res.status + ' - ' + res.statusText;
    err.message = json.error.name + (json.error.message ? ': ' + json.error.message : '');
    throw err;
  } else {
    return json;
  }
}

export function createRequest (options) {
  let request = {
    method: options.method || 'GET'
  };
  if (options.jwt) {
    request = {
      ...request,
      headers: {
        'Authorization': 'Bearer ' + options.jwt,
        'Content-Type': 'application/json'
      }
    };
  }
  if (options.body) {
    request = {
      ...request,
      body: JSON.stringify(options.body)
    };
  }
  return request;
}

export async function fetchApi (path, options) {
  options = createRequest(options);
  console.log(options);
  const res = await fetch(API_URL + path, options);
  return processResponse(res);
}
