import Vue from "vue";

const state = {
  tags: {},
};

const mutations = {
  setTags(state, value) {
    state.tags = value;
  },
};

const actions = {
  getTags(context) {
    Vue.http.get("/api/tags").then(
      (response) => {
        let items = {};
        response.body.forEach(function (item) {
          items[item.uuid] = item;
        });
        context.commit("setTags", items);
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
