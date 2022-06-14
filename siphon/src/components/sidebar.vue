<template>
    <nav class="sidebar-nav" :class="{ collapsed : isSidebarCollapsed }">
        <div class="pure-g">
            <div class="pure-u-1 header">
                <div class="pure-g">
                    <div class="pure-u-1 brand" :class="{ 'pure-u-md-4-5' : !isSidebarCollapsed }">
                        <i class="fa fa-fw" :class="icon"></i> {{ title }}
                    </div>
                    <div class="pure-u-1 compact" v-on:click="toggle"
                         :class="{ 'pure-u-md-1-5' : !isSidebarCollapsed  }">
                        <i class="fa fa-fw fa-bars compact-icon"></i>
                    </div>
                </div>
            </div>
            <div class="pure-u-1 search">
                <keep-alive>
                    <search :searchOptions="searchOptions" :minimizeSearch="isSidebarCollapsed" @searchIconClick="expand"></search>
                </keep-alive>
            </div>
            <div class="pure-u-1" v-if="!isSearchActive">
                <sidebarlink v-for="link in sidebarLinks" :key="link.title" :title="link.title" :icon="link.icon"
                             :links="link.links" :isSidebarCollapsed="isSidebarCollapsed"></sidebarlink>
            </div>
        </div>
    </nav>
</template>

<script>
  import search from './search-bar.vue'
  import sidebarlink from './sidebar-link.vue'
  export default {
    components: {
      search,
      sidebarlink
    },
    props: {
      title: {
        type: String,
        required: true
      },
      icon: {
        type: String,
        required: true
      },
      sidebarLinks: {
        type: Array,
        default: function () {
          return [{}]
        }
      },
      searchOptions: {
        type: Object,
        required: true
      }
    },
    data: function () {
      return {
        isSearchActive: false
      }
    },
    methods: {
      toggle: function () {
        this.$store.commit('updateSidebarMinimized', !this.isSidebarCollapsed)
      },
      expand: function () {
        this.$store.commit('updateSidebarMinimized', false)
      }
    },
    computed: {
      isSidebarCollapsed () {
        return this.$store.state.sidebarMinimized
      }
    }
  }
</script>

<style lang="scss" scoped>
    $sidebarBackground: #22313F;
    $sidebarButtons: #36D7B7;

    .sidebar-nav {
        background-color: $sidebarBackground;
        height: 100vh;
        color: #fff;
        position: fixed;
        width: 20%;
        transition: left .5s ease;
        overflow: auto;

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .collapsed {
        width: 100px;
    }

    @media screen and (max-width: 48em) {
        .sidebar-nav {
            left: 0;
            width: 80%;
        }

        .collapsed {
            left: -100%;
        }
    }

    .header {
        text-align: center;
        font-family: 'Lato', sans-serif;
    }

    .brand {
        padding: 15px 0;
        font-size: 18px;
    }

    .compact {
        background-color: $sidebarButtons;

        &:hover {
            background-color: darken($sidebarButtons, 10%);
        }
    }

    @media screen and (max-width: 48em) {
        .compact {
            position: fixed;
            width: 20%;
            right: 0;
            opacity: .25;

            &:hover {
                opacity: .75;
            }
        }
    }

    .compact-icon {
        padding: 15px 0;
    }

    .search {
        text-align: center;
        margin: 30px 0;
    }
</style>
