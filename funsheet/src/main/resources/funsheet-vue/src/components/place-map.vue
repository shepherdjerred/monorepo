<template>
    <div>
        <div class="card">
            <div class="card-image">
                <iframe class="map"
                        frameborder="0"
                        allowfullscreen
                        :src="src">
                </iframe>
            </div>
            <div class="card-content">
                <div class="content">
                    <router-link :to="{ name: 'Location Details', params: { 'uuid': location.uuid } }"><h1 class="title">{{ location.name }}</h1></router-link>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
    export default {
      name: 'Place-Map',
      props: {
        location: {
          type: Object,
          required: true
        }
      },
      computed: {
        src: function () {
          return 'https://www.google.com/maps/embed/v1/place?key=AIzaSyC7jbGr5go1IZesidGWwA3CR8NwDLSsEX8' +
            '&q=place_id:' + this.location.placeId;
        }
      }
    };
</script>

<style lang="scss" scoped>
    .map {
        width: 100%;
        height: 350px;
        border: 0;
    }
</style>
