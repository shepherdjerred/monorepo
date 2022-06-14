const ClubModel = require('./model');
const NamespaceModel = require('../user/authorization/statement/model');

async function addClub (req, res, next) {
  let club = new ClubModel({
    name: req.body.name,
    shortName: req.body.shortName,
    members: req.body.members
  });

  try {
    club = await club.save();
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }

  // let clubNamespace = new NamespaceModel({
  //   site: 'CLUB',
  //   resource: club._id
  // });
  //
  // try {
  //   await clubNamespace.save();
  // } catch (err) {
  //   next({
  //     status: 500,
  //     error: err
  //   });
  // }

  res.json(club);
}

async function getClubs (req, res, next) {
  try {
    let clubs = await ClubModel.find();
    res.json(clubs);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function getClub (req, res, next) {
  let club = res.locals.club;
  res.json(club);
}

async function updateClub (req, res, next) {
  let club = res.locals.club;
  club.name = req.body.name || club.name;
  club.shortName = req.body.shortName || club.shortName;
  club.members = req.body.members || club.members;
  try {
    club = await club.save();
    res.json(club);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

async function deleteClub (req, res, next) {
  try {
    let club = await res.locals.club.remove();
    res.json(club);
  } catch (err) {
    next({
      status: 500,
      error: err
    });
  }
}

module.exports = {
  addClub,
  getClubs,
  getClub,
  updateClub,
  deleteClub
};
