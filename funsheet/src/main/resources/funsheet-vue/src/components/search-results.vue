<template>
    <div>
        <template v-if="numberOfActivities > 0">
            <template v-if="searchResults.length > 0">
                <template v-for="activity in searchResults">
                    <div class="card result">
                        <header class="card-header">
                            <router-link class="card-header-title" :to="{ name: 'Activity Details', params: { 'uuid': activity.uuid } }">
                                {{ activity.name }}
                            </router-link>
                        </header>
                        <div class="card-content">
                            <div class="content">
                                {{ activity.description }}
                            </div>
                        </div>
                        <footer class="card-footer">
                        <span class="card-footer-item">
                            <template v-if="activity.cost === 0">
                                Free
                            </template>
                            <template v-else>
                                <template v-for="i in activity.cost">$</template>
                            </template>
                        </span>
                            <span class="card-footer-item">
                            <template v-for="i in activity.rating">
                                <i class="fa fa-star"></i>
                            </template>
                        </span>
                            <template v-if="activity.location">
                        <span class="card-footer-item">
                            <router-link :to="{ name: 'Location Details', params: { 'uuid': activity.location.uuid } }" class="card-footer-item">
                                {{ activity.location.name }}
                            </router-link>
                        </span>
                            </template>
                        </footer>
                    </div>
                </template>
            </template>
            <template v-else>
                <h1 class="title resultNotice">
                    <template v-if="searchQuery.length == 0">
                        Start typing to search
                    </template>
                    <template v-else>
                        No results found
                    </template>
                </h1>
            </template>
        </template>
        <template v-else>
            <h1 class="title resultNotice">
                Add an activity before searching
            </h1>
        </template>
    </div>
</template>

<script>
  import Helpers from '../helpers';

  export default {
    name: 'Search-Results',
    props: {
      searchQuery: {
        type: String,
        required: true
      },
      searchResults: {
        type: Array,
        required: true
      }
    },
    computed: {
      activities: function () {
        return this.$store.state.Activities.activities;
      },
      numberOfActivities: function () {
        return Helpers.numberOfKeys(this.activities);
      }
    }
  };
</script>

<style lang="scss" scoped>
    .result {
        margin-top: 10px;
    }

    .resultNotice {
        margin-top: 50px;
    }
</style>
