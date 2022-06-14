const jwt = require('jsonwebtoken');
const UserModel = require('../model');
const config = require('../../config');

async function login (req, res, next) {
  let email = req.body.email;
  let password = req.body.password;

  try {
    let user = await UserModel.findOne({'email': email});
    if (user) {
      if (await user.authenticate(password)) {
        res.locals.user = user;
        await sendJwt(req, res, next);
      } else {
        next({
          status: 401,
          error: {
            name: 'Invalid password'
          }
        });
      }
    } else {
      next({
        status: 404,
        error: {
          name: 'User not found'
        }
      });
    }
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function sendJwt (req, res, next) {
  let user = res.locals.user;
  let {_id, firstName, lastName, email, hNumber} = user;
  let token = jwt.sign({
    _id,
    firstName,
    lastName,
    email,
    hNumber
  }, config.jwtSecret, {
    issuer: config.jwtIssuer,
  });
  res.json({'token': token});
}

module.exports = {
  sendJwt,
  login
};
