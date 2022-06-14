const state = {
  counter: undefined
};

const mutations = {
  SOCKET_COUNTERSTATUS (context, counter) {
    // TODO when the page is first loaded, this statement shows twice. The first time it only shows '1', the second time it diplays the expected output
    // console.log(counter);
    context.counter = counter;
  }
};

const actions = {
  getCounterStatus (context) {
    this._vm.$socket.emit('getCounter');
  },
  incrementCounter (context) {
    this._vm.$socket.emit('incrementCounter');
  }
};

export default {
  state,
  mutations,
  actions
};
