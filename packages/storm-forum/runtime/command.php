<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void {
    // Database exceptions may contain credentials. Keep details out of worker logs.
    fwrite(STDERR, 'Forum command failed: ' . get_class($error) . "\n");
    exit(1);
});
$app = XF::setupApp('XF\Cli\App');
$app->start();
$console = require '/opt/storm-forum/runtime/console.php';
$status = $console->run();
if ($status === 0) { stormConsoleCleanup(); }
exit($status);
