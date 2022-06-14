const MeetingModel = require('./model');

async function getMeetingFromParameter (req, res, next, meetingId) {
  try {
    let meeting = await MeetingModel.findOne({'_id': meetingId});
    if (meeting) {
      res.locals.meeting = meeting;
      next();
    } else {
      next({
        statusCode: 404,
        error: 'Meeting not found'
      });
    }
  } catch (err) {
    next({
      statusCode: 500,
      error: err
    });
  }
}

module.exports = {
  getMeetingFromParameter
};
