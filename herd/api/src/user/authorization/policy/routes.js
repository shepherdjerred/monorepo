const express = require('express');
const controller = require('./controller');
const middleware = require('./middleware');
const authenticationMiddleware = require('../../authentication/middleware');
const router = express.Router();

router.param('policyId', middleware.getPolicyFromParameter);

router.post('/', authenticationMiddleware.authenticate, controller.addPolicy);

router.get('/', authenticationMiddleware.authenticate, controller.getPolicies);

router.get('/:policyId', authenticationMiddleware.authenticate, controller.getPolicy);

router.patch('/:policyId', authenticationMiddleware.authenticate, controller.updatePolicy);

router.delete('/:policyId', authenticationMiddleware.authenticate, controller.deletePolicy);

module.exports = router;
