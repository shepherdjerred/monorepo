const UserModel = require('./model');
const authenticationMiddleware = require('./authentication/middleware');
const authorizationMiddleware = require('./authorization/middleware');

async function getUserFromParameter (req, res, next, userId) {
  try {
    let user = await UserModel.findOne({'_id': userId});
    if (user) {
      res.locals.user = user;
      next();
    } else {
      next({
        statusCode: 404,
        error: 'User not found'
      });
    }
  } catch (err) {
    next({
      statusCode: 500,
      error: err
    });
  }
}

async function authorizeAddUser (req, res, next) {
  if (!req.body.register) {
    await authenticationMiddleware.authenticate(req, res, next);
    authorizationMiddleware.checkUserIsAuthorized('app/users/*', 'add')(req, res, next);
  } else {
    next();
  }
}

async function authorizeGetUsers (req, res, next) {
  authorizationMiddleware.checkUserIsAuthorized('app/users/*', 'get')(req, res, next);
}

async function authorizeGetUser (req, res, next) {
  let authenticatedUser = res.locals.auth.user;
  let userToGet = res.locals.user;
  if (authenticatedUser._id === userToGet._id) {
    authorizationMiddleware.checkUserIsAuthorized('app/users/self', 'get')(req, res, next);
  } else {
    authorizationMiddleware.checkUserIsAuthorized('app/users/' + userToGet._id, 'get')(req, res, next);
  }
}

async function authorizeUpdateUser (req, res, next) {
  let authenticatedUser = res.locals.auth.user;
  let userToGet = res.locals.user;
  if (authenticatedUser._id === userToGet._id) {
    authorizationMiddleware.checkUserIsAuthorized('app/users/self', 'update')(req, res, next);
  } else {
    authorizationMiddleware.checkUserIsAuthorized('app/users/' + userToGet._id, 'update')(req, res, next);
  }
}

async function authorizeDeleteUser (req, res, next) {
  authorizationMiddleware.checkUserIsAuthorized('app/users/*', 'delete')(req, res, next);
}

async function authorizeAddRoleToUser (req, res, next) {
  // TODO check namespace of role
}

async function authorizeGetRolesForUser (req, res, next) {
  // TODO allow if self
}

module.exports = {
  getUserFromParameter,
  authorizeAddUser,
  authorizeGetUsers,
  authorizeGetUser,
  authorizeUpdateUser,
  authorizeDeleteUser,
  authorizeAddRoleToUser,
  authorizeGetRolesForUser
};
