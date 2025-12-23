import Vue from 'vue';
import VueAnalytics from 'vue-analytics';
import router from './router';
import store from './store';
import Buefy from 'buefy';

import Raven from 'raven-js';
import RavenVue from 'raven-js/plugins/vue';
import WebFontLoader from 'webfontloader';

import 'font-awesome/css/font-awesome.css';
import 'buefy/lib/buefy.css';

import App from './App.vue';

WebFontLoader.load({
  google: {
    families: ['Cabin', 'Lobster']
  }
});

if (process.env.NODE_ENV === 'production') {
  Raven.config('https://5613a4599d7147a69662a029d90f3d56@sentry.io/202388')
    .addPlugin(RavenVue, Vue)
    .install();
  Vue.use(VueAnalytics, {
    id: 'UA-104313543-1',
    router
  });
} else {
  Vue.config.productionTip = true;
}

Vue.use(Buefy);

/* eslint-disable no-new */
new Vue({
  el: '#app',
  router,
  store,
  render: h => h(App)
});
