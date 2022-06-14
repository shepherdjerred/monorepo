const loglevel = require('loglevel');

// TODO have a flag for production that will show user-friendly errors instead of stack trace
function handleError (err, req, res, next) {
  loglevel.error(err);
  res.status(err.status || 500);
  res.json({
    'error': err.error
  });
}

module.exports = {
  handleError
};
