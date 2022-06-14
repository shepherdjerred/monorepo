<template>
    <div class="search-bar">
        <template v-if="!minimizeSearch">
            <input class="input"
                   placeholder="Type to search"
                   type="search"
                   v-model:query="query"
                   v-focus="hasFocus"
                   @input="search"
                   @focus="hasFocus = true"
                   @blur="hasFocus = false">
            <div class="results">
                <template v-for="(result, index) in topResults">
                    <result :name="result.name"
                            :link="result.link"
                            :type="result.type"
                            :index="index"></result>
                </template>
            </div>
        </template>
        <i class="fa fa-fw fa-search"
           v-if="minimizeSearch"
           @click="searchIconClick"></i>
    </div>
</template>

<script>
  import result from './search-result.vue'
  import Fuse from 'fuse.js'
  import { mixin as focusMixin } from 'vue-focus'

  export default {
    mixins: [
      focusMixin
    ],
    components: {
      result
    },
    props: {
      minimizeSearch: {
        type: Boolean,
        default: false
      },
      searchOptions: {
        type: Object,
        required: true
      }
    },
    data: function () {
      return {
        query: '',
        results: [],
        hasFocus: false,
        focusedResult: 0
      }
    },
    computed: {
      topResults: function () {
        return this.results.slice(0, 10)
      }
    },
    methods: {
      search: function () {
        this.results = this.fuse.search(this.query)
        this.focusedResult = 0
      },
      searchIconClick: function () {
        this.$emit('searchIconClick')
        this.hasFocus = true
      },
      moveResultFocusDown: function () {
        if (this.focusedResult < this.topResults.length - 1) {
          this.focusedResult += 1
        }
      },
      moveResultFocusUp: function () {
        if (this.focusedResult !== 0) {
          this.focusedResult -= 1
        }
      }
    },
    created: function () {
      this.fuse = new Fuse(this.searchOptions.links, this.searchOptions.options)
    }
  }
</script>

<style lang="scss" scoped>
    .search-bar {
        margin: 0 10%;
        > .input {
            color: #000;
            width: 100%;
            box-sizing: border-box;
            border: none;
            border-radius: 10px;
            padding: 7.5px;
        }

        > .results {
            margin-left: 1%;
            position: absolute;
            width: 77%;
        }
    }
</style>
