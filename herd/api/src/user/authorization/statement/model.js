const mongoose = require('mongoose');

let statementSchema = mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  namespace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Namespace',
    required: true
  },
  resource: {
    type: String,
    required: true
  },
  effect: {
    type: String,
    enum: ['ALLOW', 'DENY'],
    required: true
  },
  action: {
    type: String,
    required: true
  }
});

statementSchema.index({
  'name': 1,
  'namespace': 1
}, {
  unique: true
});

let statementModel = mongoose.model('Statement', statementSchema);

module.exports = statementModel;
