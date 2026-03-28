const config = {};

try {
  module.exports = require("@rnx-kit/jest-preset")("windows", config);
} catch {
  module.exports = {};
}
