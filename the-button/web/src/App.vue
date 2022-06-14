<template>
    <div id="app">
        <div class="appContent">
            <router-view/>
        </div>
    </div>
</template>

<script>
  export default {
    name: 'App'
  };
</script>

<style lang="scss" scoped>
    .appContent {
        min-height: 100vh;
    }
</style>
