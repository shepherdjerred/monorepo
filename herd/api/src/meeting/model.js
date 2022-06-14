const mongoose = require('mongoose');
const moment = require('moment');

let meetingSchema = mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  start: {
    type: Date,
    default: moment
  },
  end: {
    type: Date,
    default: moment().add(1, 'hours').calendar
  },
  location: {
    type: {
      type: String,
      enum: 'POINT',
      default: 'POINT'
    },
    coordinates: {
      type: [Number],
      required: true
    }
  },
  club: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    required: true,
    index: true
  },
  invitedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }],
  checkedInUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }]
});

let MeetingModel = mongoose.model('Meeting', meetingSchema);

module.exports = MeetingModel;
