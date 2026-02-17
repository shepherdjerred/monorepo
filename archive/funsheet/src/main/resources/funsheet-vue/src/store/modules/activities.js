import Vue from "vue";

const state = {
  activities: {},
};

const mutations = {
  setActivities(state, value) {
    state.activities = value;
  },
};

const actions = {
  getActivities(context) {
    Vue.http.get("/api/activities").then(
      (response) => {
        let items = {};
        response.body.forEach(function (item) {
          items[item.uuid] = item;
        });
        context.commit("setActivities", items);
      },
      (response) => {
        console.log(response.body);
      },
    );
  },
};

export default {
  state,
  mutations,
  actions,
};
