import Vue from 'vue';

const state = {
  courses: {},
  isLoaded: false
};

const mutations = {
  setCourses (state, value) {
    state.courses = value;
    state.isLoaded = true;
  }
};

const actions = {
  getCourses (context) {
    Vue.http.get(process.env.API_URL + '/api/courses').then(response => {
      let items = {};
      response.body.forEach(function (item) {
        items[item.id] = item;
      });
      context.commit('setCourses', items);
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
