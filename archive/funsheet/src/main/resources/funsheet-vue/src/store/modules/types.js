import Vue from "vue";

const state = {
  types: {},
};

const mutations = {
  setTypes(state, value) {
    state.types = value;
  },
};

const actions = {
  getTypes(context) {
    Vue.http.get("/api/types").then(
      (response) => {
        let items = {};
        response.body.forEach(function (item) {
          items[item.uuid] = item;
        });
        context.commit("setTypes", items);
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
