<template>
    <div>
        <section class="hero is-primary">
            <div class="hero-body">
                <div class="column is-one-third-desktop is-offset-one-third-desktop">
                    <h1 class="title">
                        Create tag
                    </h1>
                </div>
            </div>
        </section>
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
                            A tag called {{ name }} already exists
                        </div>
                    </template>
                </div>
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
    name: 'Create-Tag',
    data: function () {
      return {
        name: ''
      };
    },
    computed: {
      allTags: function () {
        return this.$store.state.Tags.tags;
      }
    },
    methods: {
      onSubmit: function () {
        if (this.isNameTaken()) {
          return;
        }
        this.$http.post('/api/tags', {
          'name': this.name,
          'jwt': localStorage.getItem('jwt')
        }).then(response => {
          console.log(response.body);
          this.$store.dispatch('getTags');
          this.$router.push({name: 'Tag Details', params: {'uuid': response.body.uuid}});
        }, response => {
          console.log(response.body);
        });
      },
      isNameTaken: function () {
        let self = this;
        return Helpers.objectToArray(this.allTags).some(function (tag) {
          return tag.name === self.name;
        });
      }
    }
  };
</script>
