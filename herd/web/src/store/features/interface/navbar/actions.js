export const TOGGLE_NAVBAR_EXPANDED = 'TOGGLE_NAVBAR_EXPANDED';
export const SET_NAVBAR_EXPANDED = 'SET_NAVBAR_EXPANDED';

export function toggleNavbarExpanded () {
  return function (dispatch, getState) {
    return {
      type: TOGGLE_NAVBAR_EXPANDED
    };
  };
}

export function setNavbarExpanded (isExpanded) {
  return function (dispatch, getSate) {
    return {
      type: SET_NAVBAR_EXPANDED,
      isExpanded
    };
  };
}
