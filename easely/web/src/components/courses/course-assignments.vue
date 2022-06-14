<template>
    <div>
        <div class="columns">
            <div class="column is-half is-offset-one-quarter">

                <h2 class="is-2 title">Upcoming Assignments</h2>
                <div class="columns is-multiline">
                    <template v-if="currentCourseAssignments">
                        <template v-for="assignment in currentCourseAssignments">
                            <div class="column is-half">
                                <div class="box">
                                    <div class="card-body">
                                        <router-link
                                                :to="{ name: 'Assignment Details', params: { 'id': assignment.id } }">
                                            <h5 class="title is-5">{{ assignment.name }}</h5>
                                        </router-link>
                                        <h6 class="subtitle is-6">
                                            Due {{ dueDate(assignment) }} at {{ dueTime(assignment) }}
                                        </h6>
                                        <template v-if="assignment.possiblePoints">
                                            <p>
                                                {{ assignment.possiblePoints }} Points
                                            </p>
                                        </template>
                                        <template v-else>
                                            <br>
                                        </template>
                                        <h6 class="card-subtitle mb-2 text-muted">{{ assignment.type }}</h6>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </template>
                    <template v-else>
                        <p>No upcoming assignments</p>
                    </template>
                </div>

                <h2 class="is-2 title">Past Assignments</h2>
                <div class="columns is-multiline">
                    <template v-for="assignment in pastCourseAssignments">
                        <div class="column is-half">
                            <div class="box">
                                <div class="card-body">
                                    <router-link :to="{ name: 'Assignment Details', params: { 'id': assignment.id } }">
                                        <h5 class="title is-5">{{ assignment.name }}</h5>
                                    </router-link>
                                    <h6 class="subtitle is-6">
                                        Due {{ dueDate(assignment) }} at {{ dueTime(assignment) }}
                                    </h6>
                                    <template v-if="assignment.possiblePoints">
                                        <template v-if="assignment.graded">
                                            <p>
                                                {{ assignment.earnedPoints }}/{{ assignment.possiblePoints }} Points
                                            </p>
                                        </template>
                                        <template v-else>
                                            <p>
                                                {{ assignment.possiblePoints }} Points
                                            </p>
                                        </template>
                                    </template>
                                    <template v-else>
                                        <br>
                                    </template>
                                    <h6 class="card-subtitle mb-2 text-muted">{{ assignment.type }}</h6>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
  import Helpers from '../../helpers';

  export default {
    name: 'Course-Assignments',
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
      assignments: function () {
        return this.$store.state.Assignments.assignments;
      },
      courseAssignments: function () {
        let that = this;
        let courseAssignments = [];
        Helpers.objectToArray(this.assignments).forEach(function (assignment) {
          if (assignment.course.id === that.course.id) {
            courseAssignments.push(assignment);
          }
        });
        return Helpers.sortAssignmentArrayByDate(courseAssignments);
      },
      currentCourseAssignments: function () {
        let today = Date.today();
        let assignments = [];
        this.courseAssignments.forEach(function (assignment) {
          if (Date.compare(today, new Date(assignment.date)) < 0) {
            assignments.push(assignment);
          }
        });
        return assignments;
      },
      pastCourseAssignments: function () {
        let today = Date.today();
        let assignments = [];
        this.courseAssignments.forEach(function (assignment) {
          if (Date.compare(today, new Date(assignment.date)) > 0) {
            assignments.push(assignment);
          }
        });
        return assignments;
      }
    },
    methods: {
      dueDate: function (assignment) {
        return Date.getMonthName(assignment.date.getMonth()) + ' ' + assignment.date.getDate();
      },
      dueTime: function (assignment) {
        return assignment.date.toString('h:mm tt');
      }
    }
  };
</script>

<style lang="scss" scoped>
</style>
