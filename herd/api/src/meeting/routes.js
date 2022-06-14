const express = require('express');
const controller = require('./controller');
const middleware = require('./middleware');
const clubMiddleware = require('../club/middleware');
const authenticationMiddleware = require('../user/authentication/middleware');
const router = express.Router();

router.param('meetingId', middleware.getMeetingFromParameter);

router.param('clubId', clubMiddleware.getClubFromParameter);

router.post('/', authenticationMiddleware.authenticate, controller.addMeeting);

router.get('/', authenticationMiddleware.authenticate, controller.getMeetings);

router.get('/:meetingId', authenticationMiddleware.authenticate, controller.getMeeting);

router.patch('/:meetingId', authenticationMiddleware.authenticate, controller.updateMeeting);

router.delete('/:meetingId', authenticationMiddleware.authenticate, controller.deleteMeeting);

router.get('/club/:clubId', authenticationMiddleware.authenticate, controller.getMeetingsForClub);

router.get('/club/:clubId/latest', authenticationMiddleware.authenticate, controller.getLatestMeetingForClub);

module.exports = router;
