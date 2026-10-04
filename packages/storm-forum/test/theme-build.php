<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\Cli\App');
$app->start();
$app->repository('XF:Option')->updateOption('boardUrl', 'http://127.0.0.1:18796');
// Native option writes do not refresh the current application's cached Options object.
$app->options()->boardUrl = 'http://127.0.0.1:18796';
$argv = ['build.php', '/app/forum', '/app/forum/vendor'];
require '/opt/storm-forum/themes/flexile/build.php';
