import Vue from 'vue';
import Router from 'vue-router';

import Home from '../components/app-home.vue';
import About from '../components/app-about.vue';

import Login from '../components/user/user-login.vue';
import Register from '../components/user/user-register.vue';
import Account from '../components/user/user-account.vue';
import Easel from '../components/user/user-easel.vue';
import Edit from '../components/user/user-edit.vue';

import Error404 from '../components/error-404.vue';

import AssignmentDetails from '../components/assignments/assignment-details.vue';

import CourseDetails from '../components/courses/course-details.vue';
import CourseAssignments from '../components/courses/course-assignments.vue';
import CourseGrades from '../components/courses/course-grades.vue';
import CourseResources from '../components/courses/course-resources.vue';

Vue.use(Router);

export default new Router({
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home
    },
    {
      path: '/about',
      name: 'About',
      component: About
    },
    {
      path: '/login',
      name: 'Login',
      component: Login
    },
    {
      path: '/register',
      name: 'Register',
      component: Register
    },
    {
      path: '/account',
      name: 'Account',
      component: Account,
      children: [
        {
          path: 'easel',
          name: 'User EASEL',
          component: Easel,
          props: true
        },
        {
          path: 'edit',
          name: 'User Edit',
          component: Edit,
          props: true
        }
      ]
    },
    {
      path: '/assignment/:id',
      name: 'Assignment Details',
      component: AssignmentDetails,
      props: true
    },
    {
      path: '/course/:id',
      name: 'Course Details',
      component: CourseDetails,
      props: true,
      children: [
        {
          path: '/',
          redirect: {
            name: 'Course Assignments'
          }
        },
        {
          path: 'assignments',
          name: 'Course Assignments',
          component: CourseAssignments,
          props: true
        },
        {
          path: 'grades',
          name: 'Course Grades',
          component: CourseGrades,
          props: true
        },
        {
          path: 'resources',
          name: 'Course Resources',
          component: CourseResources,
          props: true
        }
      ]
    },
    {
      path: '*',
      name: '404',
      component: Error404
    }
  ]
});
