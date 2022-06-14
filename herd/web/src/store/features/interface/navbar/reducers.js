import {TOGGLE_NAVBAR_EXPANDED, SET_NAVBAR_EXPANDED} from './actions';

let initialState = {
  isExpanded: false
};

export default function navbarReducer (state = initialState, action) {
  switch (action.type) {
    case TOGGLE_NAVBAR_EXPANDED:
      return {
        isExpanded: !state.isExpanded
      };
    case SET_NAVBAR_EXPANDED:
      return {
        isExpanded: action.isExpanded
      };
    default:
      return state;
  }
}
