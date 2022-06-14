const mongoose = require('mongoose');

let clubSchema = mongoose.Schema({
  name: {
    type: String,
    unique: true,
    required: true
  },
  shortName: {
    type: String,
    unique: true,
    required: true
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  }]
});

let ClubModel = mongoose.model('Club', clubSchema);

module.exports = ClubModel;
