<template>
    <div class="search-result">
            <applink :name="name"
                     :link="link"
                     :type="type"
                     class="result-inner"></applink>
    </div>
</template>

<script>
  import applink from './app-link.vue'
  import { mixin as focusMixin } from 'vue-focus'

  export default {
    mixins: [
      applink,
      focusMixin
    ],
    components: {
      applink
    },
    props: {
      index: {
        type: Number,
        required: true
      }
    }
  }
</script>

<style lang="scss" scoped>
    $sidebarBackground: #22313F;
    $sidebarButtons: #36D7B7;

    .search-result {
        width: 100%;
        margin-top: 3px;
        border-radius: 0;
        background-color: lighten($sidebarBackground, 10%);
        overflow-wrap: break-word;

        &:hover, &:focus {
            background-color: lighten($sidebarBackground, 15%);
        }

        > .result-inner {
            padding: 7px 5px;
        }
    }
</style>
