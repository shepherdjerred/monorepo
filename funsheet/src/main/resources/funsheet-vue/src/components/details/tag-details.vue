<template>
    <div>
        <template v-if="tag">
            <div class="hero is-primary">
                <div class="hero-body">
                    <div class="column is-two-thirds-desktop is-offset-2-desktop">
                        <h1 class="title">
                            {{ tag.name }}
                        </h1>
                    </div>
                </div>
            </div>
            <div class="column is-two-thirds-desktop is-offset-2-desktop">
                <div class="columns">
                    <div class="column">
                        <div class="card">
                            <div class="card-content">
                                <h3 class="title">All types tagged {{ tag.name }}</h3>
                                <ul>
                                    <template v-for="type in typesWithTag">
                                        <li>
                                            <router-link :to="{ name: 'Type Details', params: { 'uuid': type.uuid } }">
                                                {{ type.name }}
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
                                <h3 class="title">All activities tagged {{ tag.name }}</h3>
                                <ul>
                                    <template v-for="activity in activitiesWithTag">
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
                    <template v-if="isLoggedIn">
                        <div class="column">
                            <div class="card">
                                <footer class="card-footer">
                                    <a class="card-footer-item">
                                        <router-link :to="{ name: 'Edit Tag', params: { 'uuid': tag.uuid } }">
                                            Edit
                                        </router-link>
                                    </a>
                                    <a class="card-footer-item">
                                        <router-link :to="{ name: 'Delete Tag', params: { 'uuid': tag.uuid } }">
                                            Delete
                                        </router-link>
                                    </a>
                                </footer>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        </template>
        <template v-else>
            <div class="hero is-danger">
                <div class="hero-body">
                    <div class="container">
                        <h1 class="title">
                            Tag not found
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
    name: 'Tag-Details',
    props: {
      uuid: {
        Type: String,
        required: true
      }
    },
    computed: {
      activitiesWithTag: function () {
        return Helpers.objectToArray(this.activities).filter(activity => {
          if (activity.type) {
            return activity.type.tags.find(tag => tag.uuid === this.uuid);
          }
        });
      },
      typesWithTag: function () {
        return Helpers.objectToArray(this.types).filter(type => {
          return Helpers.objectToArray(type.tags).find(tag => tag.uuid === this.uuid);
        });
      },
      activities: function () {
        return this.$store.state.Activities.activities;
      },
      types: function () {
        return this.$store.state.Types.types;
      },
      tag: function () {
        return this.tags[this.uuid];
      },
      tags: function () {
        return this.$store.state.Tags.tags;
      },
      isLoggedIn: function () {
        return this.$store.state.User.username !== '';
      }
    }
  };
</script>

<style lang="scss" scoped>

</style>
