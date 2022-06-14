<template>
    <div class="app-container">
        <sidebar title="Siphon"
                 icon="fa-university"
                 :sidebarLinks="sidebarLinks"
                 :searchOptions="searchOptions"></sidebar>
        <div :class="[sidebarMinimized ? 'minimized' : 'maximized']">
            <router-view></router-view>
        </div>
    </div>
</template>

<script>
  import sidebar from '../components/sidebar.vue'
  import sidebarLinks from '../sidebarLinks'
  import searchOptions from '../search'
  export default {
    components: {
      sidebar
    },
    data: function () {
      return {
        sidebarLinks: sidebarLinks.links,
        searchOptions: searchOptions
      }
    },
    computed: {
      sidebarMinimized () {
        return this.$store.state.sidebarMinimized
      }
    }
  }
</script>

<style lang="scss">
    $backgroundPrimary: #3a6186;
    $backgroundSecondary: #89253e;

    html, button, input, select, textarea, .pure-g [class *= "pure-u"] {
        font-family: "Gentium Basic", serif;
    }

    h1, h2, h3, h4, h5, h6 {
        font-family: "Lato", sans-serif;
    }

    ._center {
        text-align: center;
    }

    .app-container {
        min-height: 100vh;
        background: $backgroundPrimary;
        background: linear-gradient(to left, $backgroundPrimary, $backgroundSecondary);

        > .minimized {
            margin-left: 100px;
            width: calc(100% - 100px);

            @media screen and (max-width: 48em) {
                width: 100%;
                margin-left: 0;
            }
        }

        > .maximized {
            margin-left: 20%;
            width: 80%;

            @media screen and (max-width: 48em) {
                width: 100%;
                margin-left: 0;
            }
        }
    }
</style>
