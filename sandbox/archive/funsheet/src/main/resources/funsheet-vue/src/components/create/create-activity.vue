<template>
  <div>
    <div class="hero is-primary">
      <div class="hero-body">
        <div class="column is-one-third-desktop is-offset-one-third-desktop">
          <h1 class="title">Create activity</h1>
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
        <div class="field">
          <label class="label">
            Rating
            <span>
              <input
                class="input"
                type="number"
                v-model.number="rating"
                required
                min="1"
                max="5"
              />
            </span>
          </label>
          <p class="help">Rating from 1 to 5</p>
        </div>
        <div class="field">
          <label class="label">
            Cost
            <span>
              <input
                class="input"
                type="number"
                v-model.number="cost"
                required
                min="0"
                max="5"
              />
            </span>
          </label>
          <p class="help">Cost from 0 to 5</p>
        </div>
        <div class="field">
          <label class="label">
            Description
            <span>
              <textarea
                class="textarea"
                v-model="description"
                required
              ></textarea>
            </span>
          </label>
        </div>
        <template v-if="Object.keys(allTypes).length > 0">
          <div class="field" v-on:click.capture="getTypes">
            <label class="label">
              Type
              <div class="control">
                <div class="select">
                  <select v-model="type">
                    <option v-for="type in allTypes" v-bind:value="type.uuid">
                      {{ type.name }}
                    </option>
                  </select>
                </div>
              </div>
            </label>
          </div>
        </template>
        <template v-else>
          <p>No types exist</p>
        </template>
        <template v-if="Object.keys(allLocations).length > 0">
          <div class="field" v-on:click.capture="getLocations">
            <label class="label">
              Location
              <div class="control">
                <div class="select">
                  <select v-model="location">
                    <option
                      v-for="location in allLocations"
                      v-bind:value="location.uuid"
                    >
                      {{ location.name }}
                    </option>
                  </select>
                </div>
              </div>
            </label>
          </div>
        </template>
        <template v-else>
          <p>No locations exist</p>
        </template>
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
  name: "Create-Activity",
  data: function () {
    return {
      name: "",
      rating: 1,
      cost: 0,
      description: "",
      type: null,
      location: null,
    };
  },
  computed: {
    allLocations: function () {
      return this.$store.state.Locations.locations;
    },
    allTypes: function () {
      return this.$store.state.Types.types;
    },
    allActivities: function () {
      return this.$store.state.Activities.activities;
    },
  },
  methods: {
    onSubmit: function () {
      if (this.isNameTaken()) {
        return;
      }
      this.$http
        .post("/api/activities", {
          name: this.name,
          rating: this.rating,
          type: this.type,
          cost: this.cost,
          description: this.description,
          location: this.location,
          jwt: localStorage.getItem("jwt"),
        })
        .then(
          (response) => {
            console.log(response.body);
            this.$store.dispatch("getActivities");
            this.$router.push({
              name: "Activity Details",
              params: { uuid: response.body.uuid },
            });
          },
          (response) => {
            console.log(response.body);
          },
        );
    },
    getLocations: function () {
      this.$store.dispatch("getLocations");
    },
    getTypes: function () {
      this.$store.dispatch("getTypes");
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
};
</script>
