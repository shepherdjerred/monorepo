const ClubModel = require('./model');

async function getClubFromParameter (req, res, next, clubId) {
  try {
    let club = await ClubModel.findOne({'_id': clubId}).populate('members');
    if (club) {
      res.locals.club = club;
      next();
    } else {
      next({
        statusCode: 404,
        error: 'Club not found'
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
  getClubFromParameter
};
