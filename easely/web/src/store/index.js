import Vue from 'vue';
import Vuex from 'vuex';
import VueResource from 'vue-resource';

import Assignments from './modules/assignments';
import Courses from './modules/courses';
import User from './modules/user';

Vue.use(Vuex);
Vue.use(VueResource);

Vue.http.interceptors.push(function (request, next) {
  console.log('Setting auth header: ' + localStorage.getItem('jwt'));
  request.headers.set('Authorization', 'Bearer ' + localStorage.getItem('jwt'));
  next();
});

export default new Vuex.Store({
  modules: {
    Assignments,
    Courses,
    User
  },
  strict: process.env.NODE_ENV !== 'production'
});
