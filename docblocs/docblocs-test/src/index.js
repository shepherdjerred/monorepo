const express = require('express');
const docblocks = require('../node_modules/docblocs/lib/render');
const fs = require('fs');
const util = require('util');
const asyncReadFile = util.promisify(fs.readFile);

let app = express();

async function renderBloc (filePath, options, callback) {
  // console.log(options);

  try {
    let fileContents = await asyncReadFile(filePath);

    let renderedBloc = await docblocks.render(fileContents.toString(), options._locals, options, {});

    return callback(null, renderedBloc);
  } catch (err) {
    return callback(err);
  }
}

app.engine('bloc', renderBloc);

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
