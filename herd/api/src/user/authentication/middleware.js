const jwt = require('jsonwebtoken');
const UserModel = require('../model');
const config = require('../../config');

async function authenticate (req, res, next) {
  let token = req.header('Authorization');
  if (!token) {
    next({
      status: 400,
      error: 'No jwt sent with request'
    });
  }
  try {
    token = token.replace('Bearer ', '');
    token = await jwt.verify(token, config.jwtSecret, {
      issuer: config.jwtIssuer
    });
    try {
      let user = await UserModel.findOne({'_id': token._id});
      res.locals.auth = {
        user
      };
      if (user === null) {
        next({
          status: 400,
          error: 'Invalid authentication token. User does not exist.'
        });
      }
      next();
    } catch (err) {
      next({
        status: 400,
        error: err
      });
    }
  } catch (err) {
    next({
      status: 400,
      error: err
    });
  }
}

module.exports = {
  authenticate
};
