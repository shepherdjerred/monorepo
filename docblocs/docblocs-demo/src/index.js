const express = require('express');
const expressDocblocs = require('express-docblocs');

let app = express();

app.engine('bloc', expressDocblocs);

app.set('view engine', 'bloc');

app.get('/', async function (req, res, next) {
  req.locals = {
    reqLocals: 'Req Locals'
  };
  res.locals = {
    resLocals: 'Res Locals',
    replaceVar: 'Hello world!',
    property: {
      someNumber: 4
    },
    array: [
      0,
      10,
      20,
      30
    ],
    double: function (num = 0) {
      return num * 2;
    },
    error: function () {
      throw new Error('Oops!');
    },
    helper: function (context, bloc) {
      // console.log('context: ' + context);
      // console.log('bloc: ' + bloc);
      return context.array;
    },
    curry: function (x, y) {
      return function (context, bloc) {
        return (x + y + context.property.someNumber);
      };
    },
    bool: true
  };
  app.locals = {
    appLocals: 'App Locals'
  };
  res.render('index');
});

module.exports = app;
