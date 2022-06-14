const StatementModel = require('./model');

async function addStatement (req, res, next) {
  let statement = new StatementModel({
    name: req.body.name,
    namespace: req.body.namespace,
    resource: req.body.resource,
    effect: req.body.effect,
    action: req.body.action
  });

  try {
    statement = await statement.save();
    res.json(statement);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getStatements (req, res, next) {
  try {
    let statements = await StatementModel.find();
    res.json(statements);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getStatement (req, res, next) {
  res.json(res.locals.statement);
}

async function updateStatement (req, res, next) {
  let statement = res.locals.role;
  statement.name = req.body.name || statement.name;
  statement.namespace = req.body.namespace || statement.namespace;
  statement.resource = req.body.resource || statement.resource;
  statement.effect = req.body.effect || statement.effect;
  statement.action = req.body.action || statement.action;
  try {
    statement = await statement.save();
    res.json(statement);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function deleteStatement (req, res, next) {
  try {
    let statement = await res.locals.role.remove();
    res.json(statement);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

module.exports = {
  addStatement,
  getStatements,
  getStatement,
  updateStatement,
  deleteStatement
};
