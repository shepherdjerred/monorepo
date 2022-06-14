const PolicyModel = require('./model');

async function getPolicyFromParameter (req, res, next, policyId) {
  try {
    let policy = await PolicyModel.findOne({'_id': policyId});
    if (policy) {
      res.locals.policy = policy;
      next();
    } else {
      next({
        statusCode: 404,
        error: 'Policy not found'
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
  getPolicyFromParameter
};
