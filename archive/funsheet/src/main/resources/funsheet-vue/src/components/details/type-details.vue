<template>
    <div>
        <template v-if="type">
            <div class="hero is-primary">
                <div class="hero-body">
                    <div class="column is-two-thirds-desktop is-offset-2-desktop">
                        <h1 class="title">
                            {{ type.name }}
                        </h1>
                    </div>
                </div>
            </div>
            <div class="column is-two-thirds-desktop is-offset-2">
                <div class="columns">
                    <div class="column">
                        <div class="card">
                            <div class="card-content">
                                <h3 class="title">All activities of type {{ type.name }}</h3>
                                <ul>
                                    <template v-for="activity in activitiesWithType">
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
                    </div>
                    <div class="column">
                        <div class="card">
                            <div class="card-content">
                                <h3 class="title">Tags</h3>
                                <ul>
                                    <template v-for="tag in type.tags">
                                        <li>
                                            <router-link
                                                    :to="{ name: 'Tag Details', params: { 'uuid': tag.uuid } }">
                                                {{ tag.name }}
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
                                        <router-link :to="{ name: 'Edit Type', params: { 'uuid': type.uuid } }">
                                            Edit
                                        </router-link>
                                    </a>
                                    <a class="card-footer-item">
                                        <router-link :to="{ name: 'Delete Type', params: { 'uuid': type.uuid } }">
                                            Delete
                                        </router-link>
                                    </a>
                                </footer>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </template>
        <template v-else>
            <div class="hero is-danger">
                <div class="hero-body">
                    <div class="container">
                        <h1 class="title">
                            Type not found
                        </h1>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script>
  import Helpers from '../../helpers';

  export default {
    name: 'Type-Details',
    props: {
      uuid: {
        Type: String,
        required: true
      }
    },
    computed: {
      activitiesWithType: function () {
        return Helpers.objectToArray(this.activities).filter(activity => activity.type && activity.type.uuid === this.uuid);
      },
      activities: function () {
        return this.$store.state.Activities.activities;
      },
      type: function () {
        return this.types[this.uuid];
      },
      types: function () {
        return this.$store.state.Types.types;
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
