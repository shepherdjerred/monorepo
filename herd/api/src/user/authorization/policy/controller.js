const PolicyModel = require('./model');

async function addPolicy (req, res, next) {
  let policy = new PolicyModel({
    name: req.body.name,
    statements: req.body.statements
  });

  try {
    policy = await policy.save();
    res.json(policy);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getPolicies (req, res, next) {
  try {
    let policies = await PolicyModel.find();
    res.json(policies);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getPolicy (req, res, next) {
  res.json(res.locals.policy);
}

async function updatePolicy (req, res, next) {
  let policy = res.locals.policy;
  policy.name = req.body.name || policy.name;
  policy.statements = req.body.statement || policy.statements;
  try {
    policy = await policy.save();
    res.json(policy);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function deletePolicy (req, res, next) {
  try {
    let policy = await res.locals.policy.remove();
    res.json(policy);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

module.exports = {
  addPolicy,
  getPolicies,
  getPolicy,
  updatePolicy,
  deletePolicy
};
