<template>
    <iframe class="content-container"
            sandbox="allow-scripts allow-forms allow-same-origin"
            v-bind:src="content"></iframe>
</template>

<script>
  import routerLinks from '../contentLinks'

  export default {
    computed: {
      links: function () {
        return routerLinks.links
      },
      routeName: function () {
        return this.$route.params.name
      },
      content: function () {
        if (Object.keys(this.links).includes(this.routeName)) {
          return this.links[this.routeName].url
        }
        // 404
      }
    }
  }
</script>

<style lang="scss" scoped>
    .content-container {
        border: none;
        height: 100vh;
        width: 100%;
        vertical-align: top; // Prevents the page from showing a scrollbar
    }
</style>
