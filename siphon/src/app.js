import Vue from 'vue'
import VueResource from 'vue-resource'
import WebFont from 'webfontloader'

import router from './router'
import store from './store'
import { sync } from 'vuex-router-sync'
import './analytics'

import App from './views/app-container.vue'

import 'purecss'
import 'purecss/build/grids-responsive-min.css'
import 'font-awesome/css/font-awesome.min.css'

Vue.config.productionTip = false
Vue.use(VueResource)

sync(store, router)

WebFont.load({
  google: {
    families: ['Gentium Basic', 'Open Sans']
  }
})

/* eslint-disable no-new */
new Vue({
  router,
  store,
  render: h => h(App)
}).$mount('#app')
