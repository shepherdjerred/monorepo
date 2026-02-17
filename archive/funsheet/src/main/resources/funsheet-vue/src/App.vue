<template>
  <div id="app">
    <navbar></navbar>
    <div class="content">
      <router-view></router-view>
    </div>
  </div>
</template>

<script>
import Navbar from "./components/app-navbar.vue";

export default {
  name: "App",
  components: {
    Navbar,
  },
  methods: {
    updateData: function () {
      this.$store.dispatch("getActivities");
      this.$store.dispatch("getLocations");
      this.$store.dispatch("getTypes");
      this.$store.dispatch("getTags");
      this.$store.dispatch("updateUser");
    },
  },
  created: function () {
    this.updateData();
  },
};
</script>

<style lang="scss" scoped>
@import "scss/global";

#app {
  background: $neutral-light;
  min-height: 100vh;
}

@media screen and (max-width: 1007px) {
  .content {
    padding-top: 52px;
  }
}
</style>
