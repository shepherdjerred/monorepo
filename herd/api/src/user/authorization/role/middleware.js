const RoleModel = require('./model');

async function getRoleFromParameter (req, res, next, roleId) {
  try {
    let role = await RoleModel.findOne({'_id': roleId});
    if (role) {
      res.locals.role = role;
      next();
    } else {
      next({
        statusCode: 404,
        error: 'Role not found'
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
  getRoleFromParameter
};
