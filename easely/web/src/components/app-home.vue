<template>
  <div>
    <template v-if="isLoggedIn">
      <div class="container">
        <div class="column is-10-mobile is-offset-1-mobile">
          <div class="columns">

            <div class="column is-two-thirds">
              <h3 class="title is-3">My Courses</h3>
              <course-list></course-list>
            </div>


            <div class="column is-one-third">
              <h3 class="title is-3">Assignments</h3>
              <h6 class="subtitle is-6">You have {{ upcomingAssignments.length
                }} {{ upcomingAssignments.length > 1 || upcomingAssignments.length == 0 ? 'assignments' : 'assignment'
                }} due this week</h6>
              <assignment-boxes></assignment-boxes>
            </div>
          </div>
        </div>
      </div>

    </template>


    <template v-else>
      <section class="hero is-primary is-medium">
        <div class="hero-body">
          <div class="container">
            <h1 class="title">
              Welcome to Easely
            </h1>
            <h2 class="subtitle">
              A better interface for EASEL
            </h2>
            <h2 class="subtitle">
              Please
              <router-link :to="{ name: 'Login' }" class="card-link">Login</router-link>
              or
              <router-link :to="{ name: 'Register' }" class="card-link">Register</router-link>
              to continue
            </h2>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script>
  import Helpers from '../helpers';
  import CourseList from './course-list.vue';
  import AssignmentBoxes from './assignment-boxes.vue';

  export default {
    name: 'Home',
    components: {
      CourseList,
      AssignmentBoxes
    },
    computed: {
      email: function () {
        return this.$store.state.User.email;
      },
      isLoggedIn: function () {
        return this.$store.state.User.email !== '';
      },
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
    }
  }
</script>

<style lang="scss" scoped>
  .assignmentCard {
    padding: 1rem;
    margin-bottom: .75rem;
  }

  .assignmentCard--subtitle {
    margin-bottom: .5rem;
  }

  .assignmentCard--tag a {
    color: #000;
  }
</style>
