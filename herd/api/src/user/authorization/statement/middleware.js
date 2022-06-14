const StatementModel = require('./model');

async function getStatementFromParameter (req, res, next, statementId) {
  try {
    let statement = await StatementModel.findOne({'_id': statementId});
    if (statement) {
      res.locals.statement = statement;
      next();
    } else {
      next({
        statusCode: 404,
        error: 'Statement not found'
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
  getStatementFromParameter
};
