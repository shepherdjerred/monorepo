<template>
    <div>
        <template v-for="assignment in upcomingAssignments">

            <div class="box assignmentCard">
                <router-link :to="{ name: 'Assignment Details', params: { 'id': assignment.id } }">
                    <h5 class="is-5 title">{{ assignment.name }}</h5>
                </router-link>
                <h6 class="is-6 subtitle assignmentCard--subtitle">{{ dueDate(assignment) }} at {{ dueTime(assignment) }}</h6>
                <div class="tags">
                    <span class="tag is-light assignmentCard--tag">
                      <router-link :to="{ name: 'Course Details', params: { 'id': assignment.course.id } }">
                        {{ assignment.course.name }}
                      </router-link>
                    </span>
                    <span class="tag is-light">{{ assignment.type }}</span>
                </div>
            </div>

        </template>
    </div>
</template>

<script>
  import Helpers from '../helpers';

  export default {
    name: 'Upcoming-Assignments',
    computed: {
      assignments: function () {
        return this.$store.state.Assignments.assignments;
      },

      upcomingAssignments: function () {
        let assignments = Helpers.sortAssignmentArrayByDate(Helpers.objectToArray(this.assignments));
        let upcomingAssignments = [];

        let today = new Date.today();
        let nextWeek = new Date.today().add(7).days();

        Helpers.objectToArray(assignments).forEach(function (assignment) {
          if (Date.compare(assignment.date, today) > 0) {
            if (Date.compare(assignment.date, nextWeek) < 0) {
              upcomingAssignments.push(assignment);
            }
          }
        });

        return upcomingAssignments;
      }
    },
    methods: {
      dueDate: function (assignment) {
        return Date.getMonthName(assignment.date.getMonth()) + " " + assignment.date.getDate()
      },
      dueTime: function (assignment) {
        return assignment.date.toString("h:mm tt");
      }
    }
  }
</script>

<style lang="scss" scoped>

</style>
