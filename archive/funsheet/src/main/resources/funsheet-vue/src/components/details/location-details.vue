<template>
    <div>
        <template v-if="location">
            <div class="hero is-primary">
                <div class="hero-body">
                    <div class="column is-two-thirds-desktop is-offset-2-desktop">
                        <h1 class="title">
                            {{ location.name }}
                        </h1>
                    </div>
                </div>
            </div>
            <div class="column is-two-thirds-desktop is-offset-2">
                <div class="columns">
                    <div class="column">
                        <div class="card">
                            <div class="card-content">
                                <h3 class="title">Activities in {{ location.name }}</h3>
                                <ul>
                                    <template v-for="activity in activitiesAtLocation">
                                        <li>
                                            <router-link
                                                    :to="{ name: 'Activity Details', params: { 'uuid': activity.uuid } }">
                                                {{ activity.name }}
                                            </router-link>
                                        </li>
                                    </template>
                                </ul>
                            </div>
                        </div>

                        <template v-if="isLoggedIn">
                            <div class="card controls">
                                <footer class="card-footer">
                                    <a class="card-footer-item">
                                        <router-link :to="{ name: 'Edit Location', params: { 'uuid': location.uuid } }">
                                            Edit
                                        </router-link>
                                    </a>
                                    <a class="card-footer-item">
                                        <router-link
                                                :to="{ name: 'Delete Location', params: { 'uuid': location.uuid } }">
                                            Delete
                                        </router-link>
                                    </a>
                                </footer>
                            </div>
                        </template>
                    </div>
                    <div class="column">
                        <place-view :location="location"></place-view>
                    </div>
                </div>
            </div>
        </template>
        <template v-else>
            <div class="hero is-danger">
                <div class="hero-body">
                    <div class="container">
                        <h1 class="title">
                            Location not found
                        </h1>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script>
  import PlaceView from '../place-map.vue';
  import Helpers from '../../helpers';

  export default {
    name: 'Location-Details',
    components: {
      PlaceView
    },
    props: {
      uuid: {
        Type: String,
        required: true
      }
    },
    computed: {
      activitiesAtLocation: function () {
        return Helpers.objectToArray(this.activities).filter(activity => activity.location && activity.location.uuid === this.uuid);
      },
      activities: function () {
        return this.$store.state.Activities.activities;
      },
      location: function () {
        return this.locations[this.uuid];
      },
      locations: function () {
        return this.$store.state.Locations.locations;
      },
      isLoggedIn: function () {
        return this.$store.state.User.username !== '';
      }
    }
  };
</script>

<style lang="scss" scoped>
    .controls {
        margin-top: 20px;
    }
</style>
