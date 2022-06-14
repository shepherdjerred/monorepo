const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
const promisify = require('util').promisify;

const asyncHash = promisify(bcryptjs.hash);

let userSchema = mongoose.Schema({
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  hNumber: {
    type: String,
    unique: true,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  roles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    default: []
  }],
  confirmed: {
    type: Boolean,
    default: false
  }
}, {
  toJSON: {
    getters: false,
    virtuals: false,
    transform: (doc, obj, options) => {
      delete obj.password;
      return obj;
    }
  }
});

userSchema.pre('save', function (next) {
  if (this.isModified('password')) {
    asyncHash(this.password, 10).then((hash) => {
      this.password = hash;
      next();
    });
  }
});

userSchema.methods.authenticate = async function (candidatePassword) {
  return bcryptjs.compare(candidatePassword, this.password);
};

let UserModel = mongoose.model('User', userSchema);

module.exports = UserModel;
