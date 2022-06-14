import fetch from 'cross-fetch';
import { API_URL } from './index';

export async function login (username, password) {
  let res = await fetch(API_URL + '/api/users/authentication/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username,
      password
    })
  });
  let json = await res.json();
  if (!res.ok) {
    let err = new Error();
    err.name = res.status + ' - ' + res.statusText;
    err.message = json.error.name + (json.error.message ? ': ' + json.error.message : '');
    throw err;
  }
  return json;
}
