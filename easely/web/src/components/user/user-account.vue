<template>
  <div>
    <section class="hero is-primary">
      <div class="hero-body">
        <div class="container">
          <h1 class="title">
            {{ email }}
          </h1>
        </div>
      </div>
    </section>
    <div class="container">
      <div class="columns">
        <div class="column is-one-quarter">
          <aside class="menu aboutMenu">
            <p class="menu-label">
              Account
            </p>
            <ul class="menu-list">
              <li>
                <router-link :to="{ name: 'User Edit' }" activeClass="is-active">
                  Change Password
                </router-link>
              </li>
              <li>
                <a href="" v-on:click="onClick()">
                  Logout
                </a>
              </li>
            </ul>
            <p class="menu-label">
              EASEL
            </p>
            <ul class="menu-list">
              <li>
                <router-link :to="{ name: 'User EASEL' }" activeClass="is-active">
                  Update credentials
                </router-link>
              </li>
              <li>
                <a href="https://cs.harding.edu/easel/cgi-bin/password" target="_blank">
                  <i class="fa fa-fw fa-external-link"></i> Change EASEL password
                </a>
              </li>
            </ul>
          </aside>
        </div>
        <div class="column is-three-quarters">
          <router-view></router-view>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
  export default {
    name: 'User-Account',
    computed: {
      email: function () {
        return this.$store.state.User.email;
      }
    },
    methods: {
      onClick: function () {
        localStorage.removeItem('jwt');
        this.$store.dispatch('updateUser');
        this.$router.push({name: 'Home'});
      }
    }
  };
</script>

<style lang="scss" scoped>
  .aboutMenu {
    margin-top: 20px;
  }
</style>
