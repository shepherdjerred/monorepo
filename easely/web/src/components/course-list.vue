<template>
  <div>
    <div class="columns is-multiline">
      <template v-if="courses">
        <template v-for="course in courses">
          <div class="column is-half">
            <div class="card">
              <div class="card-content">
                <div class="content">
                  <router-link :to="{ name: 'Course Details', params: { 'id': course.id } }"
                               class="card-link">
                    <h4 class="is-size-4 is-bold">{{ course.name }}</h4>
                  </router-link>
                  <p>
                    {{ course.code }} with {{ course.teacher }}
                  </p>
                </div>
              </div>
              <footer class="card-footer">
                <router-link :to="{ name: 'Course Assignments', params: { 'id': course.id } }"
                             class="card-footer-item">Assignments
                </router-link>
                <router-link :to="{ name: 'Course Grades', params: { 'id': course.id } }"
                             class="card-footer-item">Grades
                </router-link>
              </footer>
            </div>
          </div>
        </template>
      </template>
      <template v-else>
        <div class="column is-half">
          <div class="box has-text-centered">
            <h3>You aren't in any courses</h3>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
  export default {
    computed: {
      courses: function () {
        return this.$store.state.Courses.courses;
      }
    }
  }
</script>

<style lang="scss" scoped>

</style>
