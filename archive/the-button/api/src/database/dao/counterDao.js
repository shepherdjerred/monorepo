const Counter = require.main.require('./models/counter');

module.exports = function (connection) {
  async function select (uuid) {
    const [rows] = await connection.execute('SELECT * FROM counter WHERE counter_uuid = ?;', [uuid]);
    if (rows.length) {
      return new Counter(uuid, rows[0]['current_value'], rows[0]['max_value']);
    } else {
      return null;
    }
  }

  function insert (counter) {
    connection.query('INSERT INTO counter VALUES (?, ?, ?);', [counter.uuid, counter.currentValue, counter.maxValue]);
  }

  function setCurrentValue (counter) {
    connection.query('UPDATE counter SET current_value = ? WHERE counter_uuid = ?;', [counter.currentValue, counter.uuid]);
  }

  function setMaxValue (counter) {
    connection.query('UPDATE counter SET max_value = ? WHERE counter_uuid = ?;', [counter.maxValue, counter.uuid]);
  }

  return {
    select,
    insert,
    setCurrentValue,
    setMaxValue
  };
};
