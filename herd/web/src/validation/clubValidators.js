export function validateClubName (value) {
  let error;
  if (!value) error = 'You must enter a club name';
  return error;
}

export function validateClubShortName (value) {
  let error;
  if (!value) error = 'You must enter a club short name';
  return error;
}
