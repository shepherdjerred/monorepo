import jwt from 'jwt-decode';

const state = {
  username: '',
  uuid: ''
};

const mutations = {
  setUsername (state, value) {
    state.username = value;
  },
  setUuid (state, value) {
    state.uuid = value;
  }
};

const actions = {
  updateUser (context) {
    if (localStorage.getItem('jwt')) {
      let storageJwt = jwt(localStorage.getItem('jwt'));
      context.commit('setUsername', storageJwt.username);
      context.commit('setUuid', storageJwt.uuid);
    } else {
      context.commit('setUsername', '');
      context.commit('setUuid', '');
    }
  }
};

export default {
  state,
  mutations,
  actions
};
