<template>
    <div class="sidebar-link">
        <div class="link-title"
             :class="{ '_center' : isSidebarCollapsed }"
             @click="toggleExpand">
            <i class="fa fa-fw icon"
               :class="icon"></i><a v-if="!isSidebarCollapsed">{{ title }}</a>
        </div>
        <div class="link-list"
             v-if="areLinksShown">
            <template v-for="link in links">
                <applink class="list-link"
                         :key="link.name"
                         :name="link.name"
                         :link="link.link"
                         :type="link.type"></applink>
            </template>
        </div>
    </div>
</template>

<script>
  import applink from './app-link.vue'
  export default {
    components: {
      applink
    },
    data: function () {
      return {
        areLinksShown: false
      }
    },
    props: {
      isSidebarCollapsed: {
        type: Boolean,
        default: function () {
          return false
        }
      },
      title: {
        type: String,
        required: true
      },
      icon: {
        type: String,
        required: true
      },
      links: {
        type: Array,
        default: function () {
          return [
            {}
          ]
        }
      }
    },
    methods: {
      toggleExpand: function () {
        this.$emit('expand')
        if (this.links.length > 0) {
          this.areLinksShown = !this.areLinksShown
        }
      }
    }
  }
</script>

<style lang="scss" scoped>
    $titleBackground: #3A539B;
    $linkBackground: rgba(255, 255, 255, .05);

    .link-title {
        background-color: $titleBackground;
        padding: 20px 10%;
        font-family: 'Lato', sans-serif;
        font-weight: 600;
        font-size: 22px;
        text-decoration: none;
        color: #fff;

        > .icon {
            margin-right: 6px;
        }

        &:hover {
            background-color: darken($titleBackground, 5%);
        }
    }

    .list-link {
        display: block;
        padding: 7.5px 10px;
        word-wrap: break-word;
        color: #fff;
        text-decoration: none;

        &:hover {
            background-color: $linkBackground;
        }
    }

</style>
