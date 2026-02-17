<template>
  <div>
    <div class="hero is-primary">
      <div class="hero-body">
        <div class="column is-half-desktop is-offset-one-quarter-desktop">
          <h1 class="title">All Types</h1>
        </div>
      </div>
    </div>
    <div class="column is-half-desktop is-offset-one-quarter-desktop">
      <div class="tableContainer">
        <table class="table is-fullwidth">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="type in types">
              <tr>
                <td>
                  <router-link
                    :to="{ name: 'Type Details', params: { uuid: type.uuid } }"
                    >{{ type.name }}
                  </router-link>
                </td>
                <td>
                  <template v-for="(tag, index) in type.tags">
                    <router-link
                      :to="{ name: 'Tag Details', params: { uuid: tag.uuid } }"
                      >{{ tag.name }}
                    </router-link>
                    <template v-if="index < type.tags.length - 1"
                      ><span>, </span></template
                    >
                  </template>
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
  name: "Type-Table",
  computed: {
    types: function () {
      return this.$store.state.Types.types;
    },
  },
};
</script>

<style lang="scss" scoped>
.tableContainer {
  overflow: auto;
}
</style>
