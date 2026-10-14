<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\Cli\App'); $app->start();
$console = require '/opt/storm-forum/runtime/console.php';
$run = static function (bool $publish) use ($console): string {
    $input = new Symfony\Component\Console\Input\ArrayInput($publish ? ['--publish'=>true] : []);
    $input->setInteractive(false);
    $output = new Symfony\Component\Console\Output\BufferedOutput();
    if ($console->find('storm:announce')->run($input, $output) !== 0) { throw new RuntimeException('Announcement failed'); }
    stormConsoleCleanup();
    return $output->fetch();
};
$before = (int)$app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread');
if (!str_contains($run(false), 'Preview only') || (int)$app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread') !== $before) {
    throw new RuntimeException('Preview mutated forum threads');
}
if (!str_contains($run(true), 'Published:')) { throw new RuntimeException('Native thread creation did not publish'); }
$thread = $app->registry()->get('stormForumAnnouncements')['welcome-2026'];
$saved = $app->em()->find('XF:Thread', $thread, ['FirstPost']);
$saved->FirstPost->message .= "\n\nA later editorial update.";
$saved->FirstPost->save();
if (!str_contains($run(true), 'Already published:') || (int)$app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread') !== $before + 1) {
    throw new RuntimeException('Repeat publication duplicated or removed threads');
}
$app->em()->clearEntityCache();
if (!str_contains($app->em()->find('XF:Thread', $thread, ['FirstPost'])->FirstPost->message, 'A later editorial update.')) {
    throw new RuntimeException('Repeat publication overwrote a native edit');
}
echo "Announcement preview, native publication, repeatability and edit preservation passed.\n";
