<template>
  <div>
    <div class="columns">
      <div class="column is-half is-offset-one-quarter">
        <nav class="panel">
          <p class="panel-heading">
            Resources
          </p>
          <template v-if="Object.keys(course.resources).length">
            <template v-for="(link, title) in course.resources">
              <a class="panel-block" :href="'https://cs.harding.edu/easel/cgi-bin/' + link" target="_blank">
                {{ title }}
              </a>
            </template>
          </template>
          <template v-else>
            <a class="panel-block">
              This course has no resources
            </a>
          </template>
        </nav>
      </div>
    </div>
  </div>
</template>

<script>
  export default {
    name: 'Course-Resources',
    props: {
      id: {
        type: String,
        required: true
      }
    },
    computed: {
      course: function () {
        return this.courses[this.id];
      },
      courses: function () {
        return this.$store.state.Courses.courses;
      },
    }
  }
</script>

<style lang="scss" scoped>

</style>
