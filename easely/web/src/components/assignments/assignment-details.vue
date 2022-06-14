<template>
  <div>
    <section class="hero is-primary" :class="{ 'is-medium':!assignment.attachment }">
      <div class="hero-body">
        <div class="container">
          <h1 class="title">
            {{ assignment.name }}
          </h1>
          <h2 class="subtitle">
            Due on {{ dueDate(assignment) }} at {{ dueTime(assignment) }}
          </h2>
          <h2 class="subtitle">
            <template v-if="assignment.possiblePoints">
              <template v-if="assignment.graded">
                <p>Graded, you earned {{ assignment.earnedPoints }} out of {{ assignment.possiblePoints
                  }} points ({{ (assignment.earnedPoints / assignment.possiblePoints) * 100 }}%)</p>
              </template>
              <template v-else>
                <p>Not yet graded, worth {{ assignment.possiblePoints }} points</p>
              </template>
            </template>
          </h2>
        </div>
      </div>
    </section>

    <div class="column is-10-mobile is-offset-1-mobile">
      <div class="container">
        <div class="columns is-multiline">
          <div class="column is-full assignmentNavigation">
            <div class="tabs is-centered is-boxed">
              <ul>
                <li class="nav-link is-active">
                  <a>
                    <i class="fa fa-fw fa-file"></i> Attachment
                  </a>
                </li>
                <li class="nav-link">
                  <router-link :to="{ name: 'Course Details', params: { 'id': assignment.course.id } }">
                    <i class="fa fa-fw fa-book"></i> Back to {{ assignment.course.name }}
                  </router-link>
                </li>
                <template v-if="assignment.type !== 'NOTES'">
                  <li>
                    <a class="nav-link"
                       :href="'https://cs.harding.edu/easel/cgi-bin/view?id=' + assignment.id + '&action=submit'"
                       target="_blank">
                      <i class="fa fa-fw fa-external-link"></i> Submit on EASEL
                    </a>
                  </li>
                </template>
                <li>
                  <a class="nav-link" :href="'https://cs.harding.edu/easel/cgi-bin/view?id=' + assignment.id"
                     target="_blank">
                    <i class="fa fa-fw fa-external-link"></i> Open on EASEL
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div class="column is-full">
            <template v-if="assignment.attachment">
              <div>
                <div class="is-desktop">
                  <iframe :src="assignment.attachment" class="attachmentFrame"></iframe>
                </div>
                <a :href="assignment.attachment" target="_blank" class="button"><i
                    class="fa fa-fw fa-external-link"></i> Open attachment in new tab</a>
              </div>
            </template>
            <template v-else>
              <p>This assignment has no attachment</p>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
  export default {
    name: 'Assignment-Details',
    props: {
      id: {
        type: String,
        required: true
      }
    },
    computed: {
      assignment: function () {
        return this.assignments[this.id];
      },
      assignments: function () {
        return this.$store.state.Assignments.assignments;
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
  };
</script>

<style lang="scss" scoped>
  .assignmentNavigation {
    margin-top: 10px;
    margin-bottom: 0;
  }

  .attachmentFrame {
    width: 100%;
    height: 600px;
  }
</style>
