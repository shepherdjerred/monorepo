<template>
  <div>
    <nav class="navbar is-light">
      <div class="navbar-brand">
        <router-link :to="{ name: 'Home' }" class="navbar-item">Easely</router-link>
        <div class="navbar-burger burger" data-target="navbar" @click="isNavbarOpen = !isNavbarOpen" :class="{ 'is-active':isNavbarOpen }">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <div id="navbar" class="navbar-menu" :class="{ 'is-active':isNavbarOpen }">
        <div class="navbar-start">
          <router-link class="navbar-item" :to="{ name: 'Home' }">Home</router-link>
        </div>

        <div class="navbar-end">
          <template v-if="!isLoggedIn">
            <router-link class="navbar-item" :to="{ name: 'Login' }">Login</router-link>
            <router-link class="navbar-item" :to="{ name: 'Register' }">Register</router-link>
          </template>
          <template v-else>
            <router-link class="navbar-item" :to="{ name: 'Account' }">{{ email }}</router-link>
          </template>
        </div>
      </div>
    </nav>
  </div>
</template>

<script>
  export default {
    name: 'Navbar',
    data: function () {
      return {
        isNavbarOpen: false
      }
    },
    computed: {
      email: function () {
        return this.$store.state.User.email;
      },
      isLoggedIn: function () {
        return this.$store.state.User.email !== '';
      }
    },
  }
</script>

<style lang="scss" scoped>

</style>
