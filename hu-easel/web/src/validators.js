export function validateUsername (value) {
  let error;
  if (!value) error = 'You must enter a username';
  return error;
}

export function validatePassword (value) {
  let error;
  if (!value) error = 'You must enter a password';
  return error;
}
