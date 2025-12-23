const loglevel = require('loglevel');

module.exports = function (io, socket, connection) {
  let controller = require('./controller')(connection);

  let rewards = [
    'puppy',
    'kitty'
    // theme
  ];

  function getConnectedUsers () {
    loglevel.info('Getting connected users');
    socket.emit('connectedUsers', controller.getConnectedUsers());
  }

  function incrementConnectedUsers () {
    loglevel.info('Incrementing connected users');
    controller.incrementConnectedUsers();
    io.sockets.emit('connectedUsers', controller.getConnectedUsers());
  }

  function decrementConnectedUsers () {
    loglevel.info('Decrementing connected users');
    controller.decrementConnectedUsers();
    io.sockets.emit('connectedUsers', controller.getConnectedUsers());
  }

  function getCounter () {
    loglevel.info('Getting counter status');
    controller.getCounter().then((counter) => {
      socket.emit('counterStatus', counter);
    });
  }

  function incrementCounter () {
    loglevel.info('Incrementing counter');
    controller.incrementCounter().then((result) => {
      io.sockets.emit('counterStatus', result.counter);
      if (result.reward) {
        socket.emit('reward', rewards[Math.floor(Math.random() * rewards.length)]);
      }
    });
  }

  incrementConnectedUsers();
  socket.on('getCounter', getCounter);
  socket.on('incrementCounter', incrementCounter);
  socket.on('getConnectedUsers', getConnectedUsers);
  socket.on('disconnect', decrementConnectedUsers);
};
