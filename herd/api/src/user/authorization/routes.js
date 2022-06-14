const express = require('express');
const policyRouter = require('./policy/routes');
const roleRouter = require('./role/routes');
const statementRouter = require('./statement/routes');
const router = express.Router();

router.use('/policies', policyRouter);
router.use('/roles', roleRouter);
router.use('/statements', statementRouter);

module.exports = router;
