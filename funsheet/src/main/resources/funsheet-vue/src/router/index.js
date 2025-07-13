import Vue from 'vue';
import Router from 'vue-router';

import Home from '../components/app-home.vue';
import Login from '../components/user-login.vue';
import Register from '../components/user-register.vue';
import Account from '../components/user-account.vue';

import Error404 from '../components/error-404.vue';

import ActivityDetails from '../components/details/activity-details.vue';
import LocationDetails from '../components/details/location-details.vue';
import TypeDetails from '../components/details/type-details.vue';
import TagDetails from '../components/details/tag-details.vue';

import CreateActivity from '../components/create/create-activity.vue';
import CreateLocation from '../components/create/create-location.vue';
import CreateType from '../components/create/create-type.vue';
import CreateTag from '../components/create/create-tag.vue';

import AllActivities from '../components/table/activity-table.vue';
import AllLocations from '../components/table/location-table.vue';
import AllTypes from '../components/table/type-table.vue';
import AllTags from '../components/table/tag-table.vue';

import EditActivity from '../components/edit/edit-activity.vue';
import EditLocation from '../components/edit/edit-location.vue';
import EditType from '../components/edit/edit-type.vue';
import EditTag from '../components/edit/edit-tag.vue';

import DeleteActivity from '../components/delete/delete-activity.vue';
import DeleteLocation from '../components/delete/delete-location.vue';
import DeleteType from '../components/delete/delete-type.vue';
import DeleteTag from '../components/delete/delete-tag.vue';

Vue.use(Router);

// TODO Add route guards for auth
export default new Router({
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home
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
      component: Account
    },
    {
      path: '/activity/create',
      name: 'Create Activity',
      component: CreateActivity
    },
    {
      path: '/location/create',
      name: 'Create Location',
      component: CreateLocation
    },
    {
      path: '/tag/create',
      name: 'Create Tag',
      component: CreateTag
    },
    {
      path: '/type/create',
      name: 'Create Type',
      component: CreateType
    },
    {
      path: '/activity/all',
      name: 'Activity Table',
      component: AllActivities
    },
    {
      path: '/location/all',
      name: 'Location Table',
      component: AllLocations
    },
    {
      path: '/type/all',
      name: 'Type Table',
      component: AllTypes
    },
    {
      path: '/tag/all',
      name: 'Tag Table',
      component: AllTags
    },
    {
      path: '/activity/:uuid',
      name: 'Activity Details',
      component: ActivityDetails,
      props: true
    },
    {
      path: '/location/:uuid',
      name: 'Location Details',
      component: LocationDetails,
      props: true
    },
    {
      path: '/type/:uuid',
      name: 'Type Details',
      component: TypeDetails,
      props: true
    },
    {
      path: '/tag/:uuid',
      name: 'Tag Details',
      component: TagDetails,
      props: true
    },
    {
      path: '/activity/edit/:uuid',
      name: 'Edit Activity',
      component: EditActivity,
      props: true
    },
    {
      path: '/location/edit/:uuid',
      name: 'Edit Location',
      component: EditLocation,
      props: true
    },
    {
      path: '/type/edit/:uuid',
      name: 'Edit Type',
      component: EditType,
      props: true
    },
    {
      path: '/tag/edit/:uuid',
      name: 'Edit Tag',
      component: EditTag,
      props: true
    },
    {
      path: '/activity/delete/:uuid',
      name: 'Delete Activity',
      component: DeleteActivity,
      props: true
    },
    {
      path: '/location/delete/:uuid',
      name: 'Delete Location',
      component: DeleteLocation,
      props: true
    },
    {
      path: '/type/delete/:uuid',
      name: 'Delete Type',
      component: DeleteType,
      props: true
    },
    {
      path: '/tag/delete/:uuid',
      name: 'Delete Tag',
      component: DeleteTag,
      props: true
    },
    {
      path: '*',
      name: '404',
      component: Error404
    }
  ]
});
