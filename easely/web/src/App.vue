<template>
  <div id="app">
    <div class="appContent">
      <app-navbar></app-navbar>
      <router-view></router-view>
    </div>
    <app-footer></app-footer>
  </div>
</template>

<script>
  import AppNavbar from './components/app-navbar.vue';
  import AppFooter from './components/app-footer.vue';

  export default {
    name: 'App',
    components: {
      AppNavbar,
      AppFooter
    },
    method: {
      updateData: function () {
        // TODO call this function in created
        this.$store.dispatch('getAssignments');
        this.$store.dispatch('getCourses');
      }
    },
    created: function () {
      this.$store.dispatch('updateUser');
    }
  };
</script>

<style lang="scss" scoped>
  .appContent {
    min-height: calc(100vh - 30px);
  }
</style>
