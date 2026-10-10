<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, 'Minecraft endpoint fixture failed: ' . get_class($error) . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
$check = static function (bool $condition): void { if (!$condition) { throw new RuntimeException('Public status contract differs'); } };
$cachePath = '/var/lib/storm-forum/status.json';
$oldCache = is_file($cachePath) ? file_get_contents($cachePath) : null;
try {
    $fixture = json_decode(file_get_contents('/opt/storm-forum/test/fixtures/minecraft-status.json'), true, 512, JSON_THROW_ON_ERROR);
    $fixture['checkedAt'] = time();
    $fixture['java']['verifiedAt'] = time(); $fixture['bedrock']['verifiedAt'] = time();
    file_put_contents($cachePath, json_encode($fixture, JSON_THROW_ON_ERROR));
    $controller = $app->controller(Storm\Forum\Pub\Controller\Status::class, $app->request());
    $reply = $controller->actionIndex(); $public = $reply->getParam('data');
    $check($reply->getResponseType() === 'json' && $public['status']['players']['names'] === $fixture['players']['names']);
    $check(str_contains($public['html'], '.Bedrock Player') && str_contains($public['html'], '26.51') && !str_contains(json_encode($public), 'svc.cluster.local'));
    $fixture['checkedAt'] -= 181;
    file_put_contents($cachePath, json_encode($fixture, JSON_THROW_ON_ERROR));
    $public = $controller->actionIndex()->getParam('data');
    $check($public['status']['players'] === null && !str_contains($public['html'], '.Bedrock Player') && str_contains($public['html'], 'Last verified version'));
} finally {
    if ($oldCache === null) { unlink($cachePath); } else { file_put_contents($cachePath, $oldCache); }
}
echo "Native status endpoint renders fresh public rosters and hides stale names.\n";
