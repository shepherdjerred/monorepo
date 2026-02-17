<template>
  <div>
    <div class="hero is-primary">
      <div class="hero-body">
        <div class="column is-one-third-desktop is-offset-one-third-desktop">
          <h1 class="title">Create location</h1>
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
              A location called {{ name }} already exists
            </div>
          </template>
        </div>
        <div class="field">
          <label class="label">
            Place ID
            <span>
              <input class="input" v-model="placeId" required />
            </span>
          </label>
          <p class="help">
            <a
              href="https://google-developers.appspot.com/maps/documentation/javascript/examples/full/places-placeid-finder"
              target="_blank"
            >
              Place ID finder</a
            >
          </p>
        </div>
        <span>
          <button
            class="button is-danger"
            type="button"
            v-on:click="$router.go(-1)"
          >
            Cancel
          </button>
          <button class="button is-success">Create</button>
        </span>
      </form>
    </div>
  </div>
</template>

<script>
import Helpers from "../../helpers";

export default {
  name: "Create-Location",
  data: function () {
    return {
      name: "",
      placeId: "",
    };
  },
  computed: {
    allLocations: function () {
      return this.$store.state.Locations.locations;
    },
  },
  methods: {
    onSubmit: function () {
      if (this.isNameTaken()) {
        return;
      }
      this.$http
        .post("/api/locations", {
          name: this.name,
          placeId: this.placeId,
          jwt: localStorage.getItem("jwt"),
        })
        .then(
          (response) => {
            console.log(response.body);
            this.$store.dispatch("getLocations");
            this.$router.push({
              name: "Location Details",
              params: { uuid: response.body.uuid },
            });
          },
          (response) => {
            console.log(response.body);
          },
        );
    },
    isNameTaken: function () {
      let self = this;
      return Helpers.objectToArray(this.allLocations).some(function (location) {
        return location.name === self.name;
      });
    },
  },
};
</script>
