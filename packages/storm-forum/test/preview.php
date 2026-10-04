<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void {
    fwrite(STDERR, (string)$error . "\n");
    exit(1);
});
$app = XF::setupApp('XF\Cli\App');
$app->start();
$app->repository('XF:Option')->updateOption('boardUrl', 'http://127.0.0.1:18796');
$styles = $app->registry()->get('stormForumStyles') ?: [];
$parent = $app->em()->find('XF:Style', 1);
// Exercise the owned child layer on core for local visual proof. Production
// imports its licensed parents; this fixture does not simulate their behavior.
foreach (['light', 'dark'] as $mode) { $app->service('Storm\Forum:OwnedStyles')->apply($parent, $mode, $styles, $mode === 'dark' ? 'alternate' : 'default'); }
$app->registry()->set('stormForumStyles', $styles);
$mode = ($argv[1] ?? 'light') === 'dark' ? 'dark' : 'light';
$app->repository('XF:Option')->updateOption('defaultStyleId', $styles[$mode . ':normal']);
$app->repository('XF:Style')->triggerStyleDataRebuild();
$map = $app->registry()->get('stormForumMap');
$admin = $app->em()->find('XF:User', 1);
XF::asVisitor($admin, function () use ($app, $map) {
    $console = require '/opt/storm-forum/runtime/console.php';
    $input = new Symfony\Component\Console\Input\ArrayInput([]);
    $input->setInteractive(false);
    if ($console->find('storm:seed')->run($input, new Symfony\Component\Console\Output\ConsoleOutput()) !== 0) {
        throw new RuntimeException('Editorial content could not be published');
    }
    stormConsoleCleanup();
});
echo "Disposable local preview prepared.\n";
