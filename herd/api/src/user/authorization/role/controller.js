const RoleModel = require('./model');

async function addRole (req, res, next) {
  let role = new RoleModel({
    name: req.body.name,
    namespace: req.body.namespace,
    policies: req.body.policies
  });

  try {
    role = await role.save();
    res.json(role);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getRoles (req, res, next) {
  try {
    let roles = await RoleModel.find();
    res.json(roles);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getRole (req, res, next) {
  res.json(res.locals.role);
}

async function updateRole (req, res, next) {
  let role = res.locals.role;
  role.name = req.body.name || role.name;
  role.namespace = req.body.namespace || role.namespace;
  role.policies = req.body.policies || role.policies;
  try {
    role = await role.save();
    res.json(role);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function deleteRole (req, res, next) {
  try {
    let role = await res.locals.role.remove();
    res.json(role);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

module.exports = {
  addRole,
  getRoles,
  getRole,
  updateRole,
  deleteRole
};
