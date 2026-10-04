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
$console = require '/opt/storm-forum/runtime/console.php';
$input = new Symfony\Component\Console\Input\ArrayInput([]);
$input->setInteractive(false);
if ($console->find('storm:styles')->run($input, new Symfony\Component\Console\Output\ConsoleOutput()) !== 0) {
    throw new RuntimeException('Flexile preview could not import the release styles');
}
stormConsoleCleanup();
$styles = $app->registry()->get('stormForumStyles');
$mode = ($argv[1] ?? 'light') === 'dark' ? 'dark' : 'light';
$app->repository('XF:Option')->updateOption('defaultStyleId', $styles[$mode . ':normal']);
$app->repository('XF:Style')->triggerStyleDataRebuild();
$map = $app->registry()->get('stormForumMap');
$admin = $app->em()->find('XF:User', 1);
XF::asVisitor($admin, function () use ($app, $map, $console) {
    $input = new Symfony\Component\Console\Input\ArrayInput([]);
    $input->setInteractive(false);
    if ($console->find('storm:seed')->run($input, new Symfony\Component\Console\Output\ConsoleOutput()) !== 0) {
        throw new RuntimeException('Editorial content could not be published');
    }
    stormConsoleCleanup();
});
echo "Disposable local preview prepared.\n";
