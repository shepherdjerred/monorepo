import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    sidebarMinimized: false
  },
  mutations: {
    updateSidebarMinimized (state, value) {
      state.sidebarMinimized = value
    }
  }
})
