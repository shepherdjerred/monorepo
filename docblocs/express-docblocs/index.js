const docblocks = require('@shepherdjerred/docblocs/lib/render');
const fs = require('fs');
const util = require('util');
const asyncReadFile = util.promisify(fs.readFile);

async function renderBloc (filePath, options, callback) {
  // console.log(options);

  try {
    let fileContents = await asyncReadFile(filePath);

    let renderedBloc = await docblocks.render(fileContents.toString(), options._locals, options, {});

    return callback(null, renderedBloc);
  } catch (err) {
    return callback(err);
  }
}

module.exports = renderBloc;
