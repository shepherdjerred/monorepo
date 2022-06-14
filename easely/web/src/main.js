import Vue from 'vue';
import VueAnalytics from 'vue-analytics';

import App from './App';
import router from './router';
import store from './store';

import Raven from 'raven-js';
import RavenVue from 'raven-js/plugins/vue';

import 'datejs';

import 'bulma/css/bulma.css';
import 'font-awesome/css/font-awesome.min.css';

if (process.env.NODE_ENV === 'production') {
  Raven.config('https://6472606f44934cf89ddfd0ce0fd24f38@sentry.io/224474')
    .addPlugin(RavenVue, Vue)
    .install();
  Vue.use(VueAnalytics, {
    id: 'UA-107318814-1',
    router
  });
} else {
  Vue.config.productionTip = true;
}

/* eslint-disable no-new */
new Vue({
  el: '#app',
  router,
  store,
  render: h => h(App)
});
