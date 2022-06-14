<template>
  <div>
    <div class="columns is-multiline">
      <div class="column">
        <h3 class="is-3 title">Homework</h3>
        <h6 class="is-6 subtitle">{{ course.userCourseGrade.homeworkWeight }}% of grade</h6>
        <template v-if="homework.length > 0">
          <table class="table">
            <thead>
            <tr>
              <td>Name</td>
              <td>Earned</td>
              <td>Possible</td>
              <td>Percent</td>
            </tr>
            </thead>
            <tbody>
            <template v-for="assignment in homework">
              <tr>
                <td>{{ assignment.name }}</td>
                <td>{{ assignment.earnedPoints }}</td>
                <td>{{ assignment.possiblePoints }}</td>
                <td><b>{{ Math.round((assignment.earnedPoints / assignment.possiblePoints) * 100) || 0 }}%</b></td>
              </tr>
            </template>
            </tbody>
          </table>
        </template>
        <template v-else>
          <p>You have no homework to show</p>
        </template>
      </div>
      <div class="column">
        <h1 class="is-3 title">Projects</h1>
        <h6 class="is-6 subtitle">{{ course.userCourseGrade.projectWeight }}% of grade</h6>
        <template v-if="projects.length > 0">
          <table class="table">
            <thead>
            <tr>
              <td>Name</td>
              <td>Earned</td>
              <td>Possible</td>
              <td>Percent</td>
            </tr>
            </thead>
            <tbody>
            <template v-for="assignment in projects">
              <tr>
                <td>{{ assignment.name }}</td>
                <td>{{ assignment.earnedPoints }}</td>
                <td>{{ assignment.possiblePoints }}</td>
                <td><b>{{ Math.round((assignment.earnedPoints / assignment.possiblePoints) * 100) || 0 }}%</b></td>
              </tr>
            </template>
            </tbody>
          </table>
        </template>
        <template v-else>
          <p>You have no projects to show</p>
        </template>
      </div>
      <div class="column">
        <h1 class="is-3 title">Exams</h1>
        <h6 class="is-6 subtitle">{{ course.userCourseGrade.examWeight }}% of grade</h6>
        <template v-if="exams.length > 0">
          <table class="table">
            <thead>
            <tr>
              <td>Name</td>
              <td>Earned</td>
              <td>Possible</td>
              <td>Percent</td>
            </tr>
            </thead>
            <tbody>
            <template v-for="assignment in exams">
              <tr>
                <td>{{ assignment.name }}</td>
                <td>{{ assignment.earnedPoints }}</td>
                <td>{{ assignment.possiblePoints }}</td>
                <td><b>{{ Math.round((assignment.earnedPoints / assignment.possiblePoints) * 100) || 0 }}%</b></td>
              </tr>
            </template>
            </tbody>
          </table>
        </template>
        <template v-else>
          <p>You have no exams to show</p>
        </template>
      </div>
      <div class="column is-full is-centered">
        <h4 class="title is-4">Overall grade: {{ course.userCourseGrade.classAverage }}%</h4>
      </div>
    </div>
  </div>
</template>

<script>
  import Helpers from '../../helpers';

  export default {
    name: 'Course-Grades',
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
      assignmentsWithGrade: function () {
        let assignmentsWithGrade = [];
        Helpers.objectToArray(this.courseAssignments).forEach(function (assignment) {
          console.log(assignment);
            if (Object.getOwnPropertyDescriptor(assignment, 'graded')) {
              assignmentsWithGrade.push(assignment);
            }
        });
        return assignmentsWithGrade;
      },
      homework: function () {
        let assignments = [];
        this.assignmentsWithGrade.forEach(function (assignment) {
          if (assignment.type === 'HOMEWORK') {
            assignments.push(assignment);
          }
        });
        return assignments;
      },
      projects: function () {
        let assignments = [];
        this.assignmentsWithGrade.forEach(function (assignment) {
          if (assignment.type === 'PROJECT') {
            assignments.push(assignment);
          }
        });
        return assignments;
      },
      exams: function () {
        let assignments = [];
        this.assignmentsWithGrade.forEach(function (assignment) {
          if (assignment.type === 'EXAM') {
            assignments.push(assignment);
          }
        });
        return assignments;
      },
      final: function () {
        let assignments = [];
        this.assignmentsWithGrade.forEach(function (assignment) {
          if (assignment.type === 'FINAL') {
            assignments.push(assignment);
          }
        });
        return assignments;
      }
    }
  }
</script>

<style lang="scss" scoped>

</style>
