const Counter = require.main.require("./models/counter");
const Setting = require.main.require("./models/setting");
const uuid = require("uuid/v4");

let connectedUsers = 0;

module.exports = function (connection) {
  const counterDao = require.main.require("./database/dao/counterDao")(
    connection,
  );
  const settingDao = require.main.require("./database/dao/settingDao")(
    connection,
  );

  let getConnectedUsers = function () {
    return connectedUsers;
  };

  let incrementConnectedUsers = function () {
    connectedUsers += 1;
  };

  let decrementConnectedUsers = function () {
    connectedUsers -= 1;
  };

  let getCounter = async function getCounter() {
    let counter;
    let setting = await settingDao.select("active_counter");

    if (setting) {
      counter = counterDao.select(setting.settingValue);
    } else {
      counter = new Counter(uuid(), 0, 1);
      counterDao.insert(counter);
      settingDao.insert(new Setting("active_counter", counter.uuid));
    }

    return counter;
  };

  let incrementCounter = async function () {
    let counter;
    let reward = false;
    let setting = await settingDao.select("active_counter");

    if (setting) {
      counter = await counterDao.select(setting.settingValue);
    } else {
      counter = new Counter(uuid(), 0, 1);
      counterDao.insert(counter);
      settingDao.insert(new Setting("active_counter", counter.uuid));
    }

    counter.currentValue++;
    counterDao.setCurrentValue(counter);

    if (counter.maxValue < counter.currentValue) {
      counter.maxValue *= 2;
      counterDao.setMaxValue(counter);
      reward = true;
    }

    return {
      counter,
      reward,
    };
  };

  return {
    getConnectedUsers,
    incrementConnectedUsers,
    decrementConnectedUsers,
    getCounter,
    incrementCounter,
  };
};
