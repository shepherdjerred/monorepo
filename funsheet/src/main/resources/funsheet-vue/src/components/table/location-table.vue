<template>
    <div>
        <div class="hero is-primary">
            <div class="hero-body">
                <div class="column is-half-desktop is-offset-one-quarter-desktop">
                    <h1 class="title">
                        All Locations
                    </h1>
                </div>
            </div>
        </div>
        <div class="column is-half-desktop is-offset-one-quarter-desktop">
            <div class="tableContainer">
                <table class="table is-fullwidth">
                    <thead>
                    <tr>
                        <th>Name</th>
                        <th>Place ID</th>
                    </tr>
                    </thead>
                    <tbody>
                    <template v-for="location in locations">
                        <tr>
                            <td>
                                <router-link :to="{ name: 'Location Details', params: { 'uuid': location.uuid } }">
                                    {{ location.name }}
                                </router-link>
                            </td>
                            <td>
                                {{ location.placeId }}
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
    name: 'Location-Table',
    computed: {
      locations: function () {
        return this.$store.state.Locations.locations;
      }
    }
  };
</script>

<style lang="scss" scoped>
    .tableContainer {
        overflow: auto;
    }
</style>
