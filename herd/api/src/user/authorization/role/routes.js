const express = require('express');
const controller = require('./controller');
const middleware = require('./middleware');
const authenticationMiddleware = require('../../authentication/middleware');
const router = express.Router();

router.param('roleId', middleware.getRoleFromParameter);

router.post('/', authenticationMiddleware.authenticate, controller.addRole);

router.get('/', authenticationMiddleware.authenticate, controller.getRoles);

router.get('/:roleId', authenticationMiddleware.authenticate, controller.getRole);

router.patch('/:roleId', authenticationMiddleware.authenticate, controller.updateRole);

router.delete('/:roleId', authenticationMiddleware.authenticate, controller.deleteRole);

module.exports = router;
