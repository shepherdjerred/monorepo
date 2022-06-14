const express = require('express');
const controller = require('./controller');
const middleware = require('./middleware');
const authenticationMiddleware = require('../user/authentication/middleware');
const router = express.Router();

router.param('clubId', middleware.getClubFromParameter);

router.post('/', authenticationMiddleware.authenticate, controller.addClub);

router.get('/', authenticationMiddleware.authenticate, controller.getClubs);

router.get('/:clubId', authenticationMiddleware.authenticate, controller.getClub);

router.patch('/:clubId', authenticationMiddleware.authenticate, controller.updateClub);

router.delete('/:clubId', authenticationMiddleware.authenticate, controller.deleteClub);

module.exports = router;
