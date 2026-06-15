<template>
  <div>
    <template v-if="tag">
      <div class="hero is-primary">
        <div class="hero-body">
          <div class="column is-one-third-desktop is-offset-one-third-desktop">
            <h1 class="title">Edit {{ tag.name }}</h1>
          </div>
        </div>
      </div>
      <div class="column is-one-third-desktop is-offset-one-third-desktop">
        <form v-on:submit.prevent="onSubmit">
          <div class="field">
            <label class="label">
              Name
              <span>
                <input class="input" v-model="name" required />
              </span>
            </label>
            <template v-if="isNameTaken()">
              <div class="notification is-danger">
                An activity called {{ name }} already exists
              </div>
            </template>
          </div>
          <span>
            <button
              class="button is-danger"
              type="button"
              v-on:click="$router.go(-1)"
            >
              Cancel
            </button>
            <button class="button is-success">Edit</button>
          </span>
        </form>
      </div>
    </template>
    <template v-else>
      <div class="hero is-danger">
        <div class="hero-body">
          <div class="container">
            <h1 class="title">Tag not found</h1>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import Helpers from "../../helpers";

export default {
  name: "Edit-Tag",
  props: {
    uuid: {
      Type: String,
      required: true,
    },
  },
  data: function () {
    return {
      name: "",
    };
  },
  computed: {
    tag: function () {
      return this.tags[this.uuid];
    },
    tags: function () {
      return this.$store.state.Tags.tags;
    },
  },
  methods: {
    onSubmit: function () {
      this.$http
        .patch("/api/tags/" + this.uuid, {
          uuid: this.uuid,
          name: this.name,
          jwt: localStorage.getItem("jwt"),
        })
        .then(
          (response) => {
            console.log(response.body);
            this.$store.dispatch("getTags");
            this.$router.push({
              name: "Tag Details",
              params: { uuid: this.uuid },
            });
          },
          (response) => {
            console.log(response.body);
          },
        );
    },
    isNameTaken: function () {
      let self = this;
      return Helpers.objectToArray(this.allActivities).some(
        function (activity) {
          return activity.name === self.name;
        },
      );
    },
  },
  created: function () {
    this.name = this.tag.name;
  },
};
</script>
