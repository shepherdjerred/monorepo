<template>
    <div>
        <template v-if="type">
            <div class="hero is-primary">
                <div class="hero-body">
                    <div class="column is-one-third-desktop is-offset-one-third-desktop">
                        <h1 class="title">
                            Edit {{ type.name }}
                        </h1>
                    </div>
                </div>
            </div>
            <div class="column is-one-third-desktop is-offset-one-third-desktop">
                <form v-on:submit.prevent="onSubmit">
                    <div class="field">
                        <label class="label">
                            Name
                            <span>
                        <input class="input" v-model="name" required>
                    </span>
                        </label>
                        <template v-if="isNameTaken()">
                            <div class="notification is-danger">
                                An activity called {{ name }} already exists
                            </div>
                        </template>
                    </div>
                    <template v-if="allTags.length > 0">
                        <div class="field" v-on:click.capture="getTags">
                            <label class="label">
                                Tags
                                <div class="control">
                            <span class="select is-multiple">
                                <select v-model="tags" multiple>
                                    <option v-for="tag in allTags" v-bind:value="tag.uuid">
                                        {{ tag.name }}
                                    </option>
                                </select>
                            </span>
                                </div>
                            </label>
                        </div>
                    </template>
                    <template v-else>
                        <p>No tags exist</p>
                    </template>
                    <span>
                <button class="button is-danger" type="button" v-on:click="$router.go(-1)">Cancel</button>
                <button class="button is-success">Edit</button>
            </span>
                </form>
            </div>
        </template>
        <template v-else>
            <div class="hero is-danger">
                <div class="hero-body">
                    <div class="container">
                        <h1 class="title">
                            Activity not found
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
    name: 'Edit-Type',
    props: {
      uuid: {
        type: String,
        required: true
      }
    },
    data: function () {
      return {
        name: '',
        tags: []
      };
    },
    computed: {
      allTags: function () {
        return Helpers.objectToArray(this.$store.state.Tags.tags);
      },
      type: function () {
        return this.types[this.uuid];
      },
      types: function () {
        return this.$store.state.Types.types;
      }
    },
    methods: {
      onSubmit: function () {
        this.$http.patch('/api/types/' + this.uuid, {
          'uuid': this.uuid,
          'name': this.name,
          'tags': this.tags,
          'jwt': localStorage.getItem('jwt')
        }).then(response => {
          console.log(response.body);
          this.$store.dispatch('getTypes');
          this.$router.push({name: 'Type Details', params: {'uuid': this.uuid}});
        }, response => {
          console.log(response.body);
        });
      },
      getTags: function () {
        this.$store.dispatch('getTags');
      },
      isNameTaken: function () {
        let self = this;
        return Helpers.objectToArray(this.allActivities).some(function (activity) {
          return activity.name === self.name;
        });
      }
    },
    created: function () {
      this.name = this.type.name;
      let tagUuids = [];
      this.type.tags.forEach(function (tag) {
        tagUuids.push(tag.uuid);
      });
      this.tags = tagUuids;
    }
  };
</script>
