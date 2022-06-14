const express = require('express');
const controller = require('./controller');
const middleware = require('./middleware');
const authenticationMiddleware = require('../../authentication/middleware');
const router = express.Router();

router.param('statementId', middleware.getStatementFromParameter);

router.post('/', authenticationMiddleware.authenticate, controller.addStatement);

router.get('/', authenticationMiddleware.authenticate, controller.getStatements);

router.get('/:statementId', authenticationMiddleware.authenticate, controller.getStatement);

router.patch('/:statementId', authenticationMiddleware.authenticate, controller.updateStatement);

router.delete('/:statementId', authenticationMiddleware.authenticate, controller.deleteStatement);

module.exports = router;
