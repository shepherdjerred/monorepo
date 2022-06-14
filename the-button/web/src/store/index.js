import Vue from 'vue';
import Vuex from 'vuex';

import Counter from './modules/counter';
import Theme from './modules/theme';
import Reward from './modules/reward';
import ConnectedUsers from './modules/connectedUsers';

Vue.use(Vuex);

export default new Vuex.Store({
  modules: {
    Counter,
    Theme,
    Reward,
    ConnectedUsers
  },
  strict: process.env.NODE_ENV !== 'production'
});
