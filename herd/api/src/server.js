const express = require('express');
const bodyparser = require('body-parser');
const morgan = require('morgan');
const loglevel = require('loglevel');
const cors = require('cors');

const userRouter = require('./user/routes');
const clubRouter = require('./club/routes');
const meetingRouter = require('./meeting/routes');
const middleware = require('./middleware');
const config = require('./config');

require('./mongoose');

let app = express();

loglevel.setLevel('trace');

(function registerMiddleware () {
  app.options('*', cors({
    origin: config.frontEndUrl,
    allowedHeaders: 'Authorization, Content-Type',
    credentials: true
  }));
  app.use(cors({
    origin: config.frontEndUrl,
    allowedHeaders: 'Authorization, Content-Type',
    credentials: true
  }));
  app.use(morgan('dev'));
  app.use(bodyparser.json());
})();

(function registerRoutes () {
  app.use('/api/users', userRouter);
  app.use('/api/clubs', clubRouter);
  app.use('/api/meetings', meetingRouter);
})();

(function registerErrorHandlers () {
  app.use(middleware.handleError);
})();

(function listen (port) {
  app.listen(port, () => {
    loglevel.info('Express listening on port ' + port);
  });
})(config.port);
