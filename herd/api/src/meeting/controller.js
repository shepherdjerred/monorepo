const MeetingModel = require('./model');

async function addMeeting (req, res, next) {
  let meeting = new MeetingModel({
    name: req.body.name,
    description: req.body.description,
    notes: req.body.notes,
    start: req.body.start,
    end: req.body.end,
    location: req.body.location,
    attendees: req.body.attendees,
    club: req.body.club
  });

  try {
    meeting = await meeting.save();
    res.json(meeting);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getMeetings (req, res, next) {
  try {
    let meetings = await MeetingModel.find();
    res.json(meetings);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getMeeting (req, res, next) {
  res.json(res.locals.meeting);
}

async function updateMeeting (req, res, next) {
  let meeting = res.locals.meeting;
  meeting.name = req.body.name || meeting.name;
  meeting.description = req.body.description || meeting.description;
  meeting.notes = req.body.notes || meeting.notes;
  meeting.start = req.body.start || meeting.start;
  meeting.end = req.body.end || meeting.end;
  meeting.location = req.body.location || meeting.location;
  meeting.attendees = req.body.attendees || meeting.attendees;
  meeting.club = req.body.club || meeting.club;
  try {
    meeting = await meeting.save();
    res.json(meeting);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function deleteMeeting (req, res, next) {
  try {
    let club = await res.locals.meeting.remove();
    res.json(club);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getMeetingsForClub (req, res, next) {
  let club = res.locals.club;

  try {
    let meetings = await MeetingModel.find({'club': club._id});
    res.json(meetings);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getLatestMeetingForClub (req, res, next) {
  let club = res.locals.club;
  try {
    let meeting = await MeetingModel.findOne({'club': club._id}).sort('start');
    res.json(meeting);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

module.exports = {
  addMeeting,
  getMeetings,
  getMeeting,
  updateMeeting,
  deleteMeeting,
  getMeetingsForClub,
  getLatestMeetingForClub
};
