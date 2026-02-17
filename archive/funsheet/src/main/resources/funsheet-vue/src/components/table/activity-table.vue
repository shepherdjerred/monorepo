<template>
  <div>
    <div class="hero is-primary">
      <div class="hero-body">
        <div class="column is-half-desktop is-offset-one-quarter-desktop">
          <h1 class="title">All Activities</h1>
        </div>
      </div>
    </div>
    <div class="column is-half-desktop is-offset-one-quarter-desktop">
      <div class="tableContainer">
        <table class="table is-fullwidth">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Rating</th>
              <th>Cost</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="activity in activities">
              <tr>
                <td>
                  <router-link
                    :to="{
                      name: 'Activity Details',
                      params: { uuid: activity.uuid },
                    }"
                  >
                    {{ activity.name }}
                  </router-link>
                </td>
                <td>
                  <template v-if="activity.type">
                    <router-link
                      :to="{
                        name: 'Type Details',
                        params: { uuid: activity.type.uuid },
                      }"
                    >
                      {{ activity.type.name }}
                    </router-link>
                  </template>
                  <template v-else> None </template>
                </td>
                <td>
                  {{ activity.rating }}
                </td>
                <td>
                  {{ activity.cost }}
                </td>
                <td>
                  <template v-if="activity.location">
                    <router-link
                      :to="{
                        name: 'Location Details',
                        params: { uuid: activity.location.uuid },
                      }"
                    >
                      {{ activity.location.name }}
                    </router-link>
                  </template>
                  <template v-else> None </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "Activity-Table",
  computed: {
    activities: function () {
      return this.$store.state.Activities.activities;
    },
  },
};
</script>

<style lang="scss" scoped>
.tableContainer {
  overflow: auto;
}
</style>
