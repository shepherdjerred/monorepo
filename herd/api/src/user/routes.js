const express = require('express');
const controller = require('./controller');
const middleware = require('./middleware');
const authenticationMiddleware = require('./authentication/middleware');
const authorizationRoleMiddleware = require('./authorization/role/middleware');
const authenticationRouter = require('./authentication/routes');
const authorizationRouter = require('./authorization/routes');
const router = express.Router();

// Middleware
router.param('userId', middleware.getUserFromParameter);
router.param('roleId', authorizationRoleMiddleware.getRoleFromParameter);

// Add user
router.post('/',
  middleware.authorizeAddUser,
  controller.addUser
);

// List users
router.get('/',
  authenticationMiddleware.authenticate,
  middleware.authorizeGetUsers,
  controller.getUsers
);

// Get user details
router.get('/:userId',
  authenticationMiddleware.authenticate,
  middleware.authorizeGetUser,
  controller.getUser
);

// Update user
router.patch('/:userId',
  authenticationMiddleware.authenticate,
  middleware.authorizeUpdateUser,
  controller.updateUser
);

// Delete user
router.delete('/:userId',
  authenticationMiddleware.authenticate,
  middleware.authorizeDeleteUser,
  controller.deleteUser
);

// Add a role to a user
router.post('/:userId/roles/add/:roleId',
  authenticationMiddleware.authenticate,
  middleware.authorizeAddRoleToUser,
  controller.addRoleToUser
);

// Get the roles of a user
router.get('/:userId/roles/',
  authenticationMiddleware.authenticate,
  middleware.authorizeGetRolesForUser,
  controller.getRolesForUser
);

router.use('/authentication', authenticationRouter);
router.use('/authorization', authorizationRouter);

module.exports = router;
