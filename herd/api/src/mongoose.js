const loglevel = require('loglevel');
const mongoose = require('mongoose');
const config = require('./config');

mongoose.connect(config.mongoDbUrl);

let connection = mongoose.connection;
connection.on('error', function () {
  loglevel.error('Error connecting to database');
});
connection.once('open', function () {
  loglevel.info('Connected to database');
});

module.exports = mongoose;
