import Vue from 'vue';
import Vuex from 'vuex';
import VueResource from 'vue-resource';

import Activities from './modules/activities';
import Locations from './modules/locations';
import Types from './modules/types';
import Tags from './modules/tags';
import User from './modules/user';

Vue.use(Vuex);
Vue.use(VueResource);

export default new Vuex.Store({
  modules: {
    Activities,
    Locations,
    Types,
    Tags,
    User
  },
  strict: process.env.NODE_ENV !== 'production'
});
