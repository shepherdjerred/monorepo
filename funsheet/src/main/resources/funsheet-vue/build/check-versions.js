var chalk = require('chalk');
var semver = require('semver');
var packageConfig = require('../package.json');
var shell = require('shelljs');
function exec (cmd) {
  return require('child_process').execSync(cmd).toString().trim();
}

var versionRequirements = [
  {
    name: 'node',
    currentVersion: semver.clean(process.version),
    versionRequirement: packageConfig.engines.node
  }
];

if (shell.which('npm')) {
  versionRequirements.push({
    name: 'npm',
    currentVersion: exec('npm --version'),
    versionRequirement: packageConfig.engines.npm
  });
}

module.exports = function () {
  let i;
  var warnings = [];
  for (i = 0; i < versionRequirements.length; i++) {
    var mod = versionRequirements[i];
    if (!semver.satisfies(mod.currentVersion, mod.versionRequirement)) {
      warnings.push(mod.name + ': ' +
        chalk.red(mod.currentVersion) + ' should be ' +
        chalk.green(mod.versionRequirement)
      );
    }
  }

  if (warnings.length) {
    console.log('');
    console.log(chalk.yellow('To use this template, you must update following to modules:'));
    console.log();
    for (i = 0; i < warnings.length; i++) {
      var warning = warnings[i];
      console.log('  ' + warning);
    }
    console.log();
    process.exit(1);
  }
};
