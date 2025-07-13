<template>
    <div>
        <template v-if="location">
            <div class="hero is-primary">
                <div class="hero-body">
                    <div class="column is-one-third-desktop is-offset-one-third-desktop">
                        <h1 class="title">
                            Delete {{ location.name }}
                        </h1>
                    </div>
                </div>
            </div>
            <div class="column is-one-third-desktop is-offset-one-third-desktop">
                <div>
                    <form v-on:submit.prevent="onSubmit">
                        <h1 class="title">Are you sure you want to delete {{ location.name }}?</h1>
                        <span>
                <button class="button is-danger" type="button" v-on:click="$router.go(-1)">Cancel</button>
                <button class="button is-success">Confirm</button>
            </span>
                    </form>
                </div>
            </div>
        </template>
        <template v-else>
            <div class="hero is-danger">
                <div class="hero-body">
                    <div class="container">
                        <h1 class="title">
                            Location not found
                        </h1>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script>
  export default {
    name: 'Delete-Location',
    data: function () {
      return {
        name: ''
      };
    },
    props: {
      uuid: {
        type: String,
        required: true
      }
    },
    computed: {
      location: function () {
        return this.locations[this.uuid];
      },
      locations: function () {
        return this.$store.state.Locations.locations;
      }
    },
    methods: {
      onSubmit: function () {
        this.$http.delete('/api/locations/' + this.location.uuid, {
          'jwt': localStorage.getItem('jwt')
        }).then(response => {
          this.$store.dispatch('getLocations');
          this.$router.push({name: 'Home'});
        }, response => {
          console.log(response.body);
        });
      }
    }
  };
</script>
