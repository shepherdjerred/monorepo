<template>
    <div>
        <nav class="navbar">
            <div class="navbar-brand">
                <router-link :to="{ name: 'Home' }" class="navbar-item" v-on:click.native="toggleActive()">
                    Funsheet
                </router-link>
                <div class="navbar-burger burger" v-bind:class="{ 'is-active': isActive }" data-target="navbar"
                     v-on:click="toggleActive()">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>

            <div id="navbar" class="navbar-menu" v-bind:class="{ 'is-active': isActive }">
                <div class="navbar-start">
                    <router-link class="navbar-item" :to="{ name: 'Home' }" active-class="is-active"
                                 v-on:click.native="toggleActive()" exact>
                        Home
                    </router-link>
                    <template v-if="isLoggedIn">
                        <div class="navbar-item has-dropdown is-hoverable">
                            <a class="navbar-link">
                                Create
                            </a>
                            <div class="navbar-dropdown">
                                <router-link class="navbar-item" :to="{ name: 'Create Activity' }"
                                             active-class="is-active"
                                             v-on:click.native="toggleActive()">
                                    Activity
                                </router-link>
                                <router-link class="navbar-item" :to="{ name: 'Create Location' }"
                                             active-class="is-active"
                                             v-on:click.native="toggleActive()">
                                    Location
                                </router-link>
                                <router-link class="navbar-item" :to="{ name: 'Create Type' }" active-class="is-active"
                                             v-on:click.native="toggleActive()">
                                    Type
                                </router-link>
                                <router-link class="navbar-item" :to="{ name: 'Create Tag' }" active-class="is-active"
                                             v-on:click.native="toggleActive()">
                                    Tag
                                </router-link>
                            </div>
                        </div>
                    </template>
                    <div class="navbar-item has-dropdown is-hoverable">
                        <a class="navbar-link">
                            View all
                        </a>
                        <div id="blogDropdown" class="navbar-dropdown">
                            <router-link class="navbar-item" :to="{ name: 'Activity Table' }" active-class="is-active"
                                         v-on:click.native="toggleActive()">
                                Activities
                            </router-link>
                            <router-link class="navbar-item" :to="{ name: 'Location Table' }" active-class="is-active"
                                         v-on:click.native="toggleActive()">
                                Locations
                            </router-link>
                            <router-link class="navbar-item" :to="{ name: 'Type Table' }" active-class="is-active"
                                         v-on:click.native="toggleActive()">
                                Types
                            </router-link>
                            <router-link class="navbar-item" :to="{ name: 'Tag Table' }" active-class="is-active"
                                         v-on:click.native="toggleActive()">
                                Tags
                            </router-link>
                        </div>
                    </div>
                </div>

                <div class="navbar-end">
                    <div class="navbar-item">
                        <div class="field is-grouped">
                            <p class="control">
                                <template v-if="!isLoggedIn">
                                    <router-link class="button"
                                                 :to="{name:'Login'}"
                                                 v-on:click="toggleActive()">
                                    <span class="icon">
                                        <i class="fa fa-user"></i>
                                    </span>
                                        <span>Login</span>
                                    </router-link>
                                </template>
                                <template v-else>
                                    <router-link class="button"
                                                 :to="{name:'Account'}"
                                                 v-on:click="toggleActive()">
                                    <span class="icon">
                                        <i class="fa fa-user"></i>
                                    </span>
                                        <span>{{ username }}</span>
                                    </router-link>
                                </template>
                            </p>
                        </div>
                    </div>
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
        isActive: false
      };
    },
    computed: {
      username: function () {
        return this.$store.state.User.username;
      },
      isLoggedIn: function () {
        return this.$store.state.User.username !== '';
      }
    },
    methods: {
      toggleActive: function () {
        this.isActive = !this.isActive;
      }
    }
  };
</script>

<style lang="scss" scoped>
    @import '../scss/global';

    @media screen and (max-width: 1007px) {
        .navbar {
            position: fixed;
            z-index: 100;
            width: 100%;
        }
    }

    .navbar-brand {
        font-family: $font-brand;
    }
</style>
