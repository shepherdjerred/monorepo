<template>
    <div>
        <input class="input"
               type="search"
               title="Search"
               v-on:input="search"
               v-model="query"
               :placeholder="randomActivity.name">
    </div>
</template>

<script>
  import Fuse from 'fuse.js';
  import Helpers from '../helpers';

  export default {
    name: 'Search-Bar',
    data: function () {
      return {
        query: '',
        results: [],
        searchOptions: {
          shouldSort: true,
          threshold: 0.6,
          location: 0,
          distance: 100,
          maxPatternLength: 32,
          minMatchCharLength: 1,
          keys: [
            'name',
            'type.name',
            'type.tags.name',
            'location.name'
          ]
        }
      };
    },
    computed: {
      activities: function () {
        return this.$store.state.Activities.activities;
      },
      randomActivity: function () {
        if (Helpers.numberOfKeys(this.activities) > 0) {
          return Helpers.pickRandomProperty(this.activities);
        } else {
          return 'Search for an activity';
        }
      }
    },
    methods: {
      search: function () {
        let fuse = new Fuse(Helpers.objectToArray(this.activities), this.searchOptions);
        this.results = fuse.search(this.query);
        this.$emit('input', this.results, this.query);
      }
    }
  };
</script>

<style lang="scss" scoped>
    @import '../scss/global';
</style>
