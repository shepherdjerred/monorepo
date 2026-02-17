<template>
  <div>
    <div class="hero is-primary">
      <div class="hero-body">
        <div class="column is-one-third-desktop is-offset-one-third-desktop">
          <h1 class="title">Let's find something to do</h1>
          <search-bar v-on:input="updateSearchResults"></search-bar>
        </div>
      </div>
    </div>

    <div class="column is-one-third-desktop is-offset-one-third-desktop">
      <search-results
        :searchResults="searchResults"
        :searchQuery="searchQuery"
      ></search-results>
    </div>
  </div>
</template>

<script>
import SearchBar from "./search-bar.vue";
import SearchResults from "./search-results.vue";

export default {
  name: "App-Home",
  components: {
    SearchBar,
    SearchResults,
  },
  data: function () {
    return {
      searchQuery: "",
      searchResults: [],
    };
  },
  methods: {
    updateSearchResults: function (results, query) {
      this.searchResults = results;
      this.searchQuery = query;
    },
  },
};
</script>

<style lang="scss" scoped>
@import "../scss/global";
</style>
