const mongoose = require('mongoose');

let roleSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  namespace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Namespace',
    required: true
  },
  policies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Policy'
  }]
});

roleSchema.index({
  'name': 1,
  'namespace': 1
}, {
  unique: true
});

roleSchema.pre('validate', function (next) {
  let namespace = this.namespace;
  for (let policy of this.policies) {
    if (policy.namespace !== namespace) {
      next(new Error('A role cannot contain a policy in a different namespace'));
      return;
    }
  }
  next();
});

let roleModel = mongoose.model('Role', roleSchema);

module.exports = roleModel;
