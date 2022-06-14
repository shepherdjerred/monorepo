<template>
    <div>
        <div class="hero is-primary">
            <div class="hero-body">
                <div class="column is-one-third-desktop is-offset-one-third-desktop">
                    <h1 class="title">
                        Create type
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
                            A type called {{ name }} already exists
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
                <button class="button is-success">Create</button>
            </span>
            </form>
        </div>
    </div>
</template>

<script>
  import Helpers from '../../helpers';

  export default {
    name: 'Create-Type',
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
      allTypes: function () {
        return this.$store.state.Types.types;
      }
    },
    methods: {
      onSubmit: function () {
        if (this.isNameTaken()) {
          return;
        }
        this.$http.post('/api/types', {
          'name': this.name,
          'tags': this.tags,
          'jwt': localStorage.getItem('jwt')
        }).then(response => {
          console.log(response.body);
          this.$store.dispatch('getTypes');
          this.$router.push({name: 'Type Details', params: {'uuid': response.body.uuid}});
        }, response => {
          console.log(response.body);
        });
      },
      getTags: function () {
        this.$store.dispatch('getTags');
      },
      isNameTaken: function () {
        let self = this;
        return Helpers.objectToArray(this.allTypes).some(function (type) {
          return type.name === self.name;
        });
      }
    }
  };
</script>
