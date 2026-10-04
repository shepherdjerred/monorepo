<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\Cli\App');
$app->start();
$console = require '/opt/storm-forum/runtime/console.php';
foreach (['SV/StandardLib', 'SV/ContentRatings', 's9e/MediaSites', 'Storm/Forum'] as $id) {
    $addOn = $app->addOnManager()->getById($id);
    if (!$addOn) { throw new RuntimeException("Missing release add-on: {$id}"); }
    $command = $addOn->canInstall() ? 'xf:addon-install' : ($addOn->canUpgrade() ? 'xf:addon-upgrade' : null);
    if ($command === null) { continue; }
    $input = new Symfony\Component\Console\Input\ArrayInput(['command' => $command, 'id' => $id]);
    $input->setInteractive(false);
    if ($console->run($input, new Symfony\Component\Console\Output\ConsoleOutput()) !== 0) {
        throw new RuntimeException("Add-on operation failed: {$id}");
    }
    stormConsoleCleanup();
}
