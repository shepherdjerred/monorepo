const Setting = require.main.require("./models/setting");

module.exports = function (connection) {
  async function select(settingKey) {
    const [rows] = await connection.execute(
      "SELECT * FROM setting WHERE setting_key = ?",
      [settingKey],
    );
    if (rows.length) {
      return new Setting(rows[0]["setting_key"], rows[0]["setting_value"]);
    } else {
      return null;
    }
  }

  function insert(setting) {
    connection.query("INSERT INTO setting VALUES (?, ?)", [
      setting.settingKey,
      setting.settingValue,
    ]);
  }

  return {
    select,
    insert,
  };
};
