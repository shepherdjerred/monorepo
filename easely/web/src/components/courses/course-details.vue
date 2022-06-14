<template>
  <div>
    <section class="hero is-primary">
      <div class="hero-body">
        <div class="container">
          <h1 class="title">
            {{ course.name }}
          </h1>
          <h2 class="subtitle">
            {{ course.code }} with {{ course.teacher }}
          </h2>
        </div>
      </div>
    </section>
    <div class="column is-10-mobile is-offset-1-mobile">
      <div class="container">
        <div class="columns">
          <div class="column courseNavigation">
            <div class="tabs is-centered is-boxed">
              <ul>
                <router-link :to="{ name: 'Course Assignments' }" class="nav-link" activeClass="is-active" tag="li">
                  <a>
                    <i class="fa fa-fw fa-file"></i> Assignments
                  </a>
                </router-link>
                <router-link :to="{ name: 'Course Grades' }" class="nav-link" activeClass="is-active" tag="li">
                  <a>
                    <i class="fa fa-fw fa-check"></i> Grades
                  </a>
                </router-link>
                <router-link :to="{ name: 'Course Resources' }" class="nav-link" activeClass="is-active" tag="li">
                  <a>
                    <i class="fa fa-fw fa-link"></i> Class Resources
                  </a>
                </router-link>
                <li>
                  <a class="nav-link" :href="'https://cs.harding.edu/easel/cgi-bin/class?id=' + course.id"
                     target="_blank">
                    <i class="fa fa-fw fa-external-link"></i> Open on EASEL
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <router-view></router-view>
      </div>
    </div>
  </div>
</template>

<script>
  import Helpers from '../../helpers';

  export default {
    name: 'Course-Details',
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
      }
    }
  };
</script>

<style lang="scss" scoped>
  .courseNavigation {
    margin-top: 20px;
  }
</style>
