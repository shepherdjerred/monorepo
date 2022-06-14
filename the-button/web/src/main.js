import Vue from 'vue';
import Raven from 'raven-js';
import RavenVue from 'raven-js/plugins/vue';
import App from './App';
import router from './router';
import store from './store';
import vueSocketio from 'vue-socket.io';
import VueAnalytics from 'vue-analytics';

import 'bulma';
import 'font-awesome/css/font-awesome.min.css';

Raven.config('https://f7fb18c3c7194c9589192cc0aab51c84@sentry.io/287017')
  .addPlugin(RavenVue, Vue)
  .install();

Vue.use(VueAnalytics, {
  id: 'UA-49467961-4',
  router
});

Vue.config.productionTip = false;

let socketioServer;

if (process.env.NODE_ENV === 'production') {
  socketioServer = process.env.API_URL || 'http://localhost:80';
} else {
  socketioServer = 'http://localhost:8080';
}

Vue.use(vueSocketio, socketioServer, store);

/* eslint-disable no-new */
new Vue({
  el: '#app',
  router,
  store,
  render: h => h(App)
});
