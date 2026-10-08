<?php
// The installation password stays in process memory, never in argv or command output.
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\Install\App');
$app->start();
if ((new XF\Install\Helper($app))->isInstalled()) {
    fwrite(STDOUT, "Existing installation; no install action taken.\n");
    exit(0);
}
if ($app->db()->fetchOne('SHOW TABLES')) {
    throw new RuntimeException('Incomplete installation: inspect the failed release before resuming; existing tables will not be overwritten.');
}
$get = static function (string $key): string {
    $value = getenv($key);
    if ($value === false || $value === '') { throw new RuntimeException("Missing {$key}"); }
    return $value;
};
$input = new Symfony\Component\Console\Input\ArrayInput([
    '--user' => $get('ADMIN_USERNAME'), '--password' => $get('ADMIN_PASSWORD'),
    '--email' => $get('ADMIN_EMAIL'), '--title' => 'The Storm',
    '--url' => $get('FORUM_URL'), '--skip-statistics' => true,
]);
$input->setInteractive(false);
$console = require '/opt/storm-forum/runtime/console.php';
$command = $console->find('xf:install');
$status = $command->run($input, new Symfony\Component\Console\Output\ConsoleOutput());
if ($status === 0) { stormConsoleCleanup(); }
exit($status);
