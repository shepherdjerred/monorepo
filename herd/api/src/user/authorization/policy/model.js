const mongoose = require('mongoose');

let policySchema = mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  namespace: {
    type: String,
    ref: 'Namespace',
    required: true
  },
  statements: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Statement'
  }]
});

policySchema.pre('validate', function (next) {
  let namespace = this.namespace;
  for (let statement of this.statements) {
    if (statement.namespace !== namespace) {
      next(new Error('A policy cannot contain a statement in a different namespace'));
      return;
    }
  }
  next();
});

let policyModel = mongoose.model('Policy', policySchema);

module.exports = policyModel;
