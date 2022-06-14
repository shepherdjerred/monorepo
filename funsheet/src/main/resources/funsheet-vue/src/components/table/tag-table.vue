<template>
    <div>
        <div class="hero is-primary">
            <div class="hero-body">
                <div class="column is-half-desktop is-offset-one-quarter-desktop">
                    <h1 class="title">
                        All Tags
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
                    </tr>
                    </thead>
                    <tbody>
                    <template v-for="tag in tags">
                        <tr>
                            <td>
                                <router-link :to="{ name: 'Tag Details', params: { 'uuid': tag.uuid } }">{{ tag.name
                                    }}
                                </router-link>
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
    name: 'Tag-Table',
    computed: {
      tags: function () {
        return this.$store.state.Tags.tags;
      }
    }
  };
</script>

<style lang="scss" scoped>
    .tableContainer {
        overflow: auto;
    }
</style>
