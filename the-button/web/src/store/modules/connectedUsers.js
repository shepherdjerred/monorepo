const state = {
  connectedUsers: 0
};

const mutations = {
  SOCKET_CONNECTEDUSERS (context, connectedUsers) {
    context.connectedUsers = connectedUsers;
  }
};

const actions = {
  getConnectedUsers (context) {
    this._vm.$socket.emit('getConnectedUsers');
  }
};

export default {
  state,
  mutations,
  actions
};
