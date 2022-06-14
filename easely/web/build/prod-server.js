var express = require('express');
var config = require('../config')

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = JSON.parse(config.prod.env.NODE_ENV);
}

if (!process.env.API_URL) {
  process.env.API_URL = JSON.parse(config.prod.env.API_URL);
}

app = express();
app.use(express.static('dist'));

var port = process.env.PORT || 80;

app.listen(port);

console.log('App started on ' + port);
