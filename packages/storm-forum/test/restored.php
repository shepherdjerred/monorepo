<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, 'Restored fixture failed: ' . get_class($error) . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App');
$app->start();
if ($app->options()->boardUrl !== 'https://storm-forum-beta.tailnet-1a49.ts.net' || $app->options()->registrationSetup['enabled']) { throw new RuntimeException('Recovery did not normalize beta URL and close registration'); }
$styles = $app->registry()->get('stormForumStyles');
if (!is_array($styles) || $app->options()->defaultStyleId != $styles['system:normal']) { throw new RuntimeException('Recovery did not select the configured normal System style'); }
$map = $app->registry()->get('stormForumMap');
if (count(array_filter(array_keys($map), fn($key) => str_starts_with($key, 'node:'))) !== 14) { throw new RuntimeException('Restored forum tree differs'); }
foreach (['data' => "storm-owned-attachment\n", 'internal_data' => "storm-private-attachment\n"] as $directory => $expected) {
    if (file_get_contents('/var/lib/storm-forum/' . $directory . '/restore-sentinel.txt') !== $expected) { throw new RuntimeException('Attachment content differs after restore'); }
}
$author = $app->finder('XF:User')->where('username', 'LocalAuthor')->fetchOne();
$other = $app->finder('XF:User')->where('username', 'LocalOther')->fetchOne();
$private = $app->finder('XF:Thread')->where('node_id', $map['node:reports'])->fetchOne();
if (!XF::asVisitor($author, fn() => $private->canView()) || XF::asVisitor($other, fn() => $private->canView())) { throw new RuntimeException('Restored permissions differ'); }
echo "Actual database/attachment restore and private support permissions passed.\n";
