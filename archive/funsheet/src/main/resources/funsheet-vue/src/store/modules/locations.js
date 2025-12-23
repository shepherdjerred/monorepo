import Vue from 'vue';

const state = {
  locations: {}
};

const mutations = {
  setLocations (state, value) {
    state.locations = value;
  }
};

const actions = {
  getLocations (context) {
    Vue.http.get('/api/locations').then(response => {
      let items = {};
      response.body.forEach(function (item) {
        items[item.uuid] = item;
      });
      context.commit('setLocations', items);
    }, response => {
      console.log(response.body);
    });
  }
};

export default {
  state,
  mutations,
  actions
};
