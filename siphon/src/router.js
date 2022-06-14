import Vue from 'vue'
import Router from 'vue-router'

import Content from './views/content-container.vue'
import Dashboard from './views/dashboard.vue'
import Settings from './views/settings.vue'

Vue.use(Router)

export default new Router({
  routes: [
    {
      name: 'Dashboard',
      path: '/',
      component: Dashboard
    },
    {
      name: 'Content',
      path: '/content/:name',
      component: Content
    },
    {
      name: 'Settings',
      path: '/settings',
      component: Settings
    }
  ]
})
