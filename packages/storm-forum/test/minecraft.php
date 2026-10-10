<?php
require_once '/opt/storm-forum/addon/Storm/Forum/Service/MinecraftStatus.php';
use Storm\Forum\Service\MinecraftStatus;
$check = static function (bool $condition, string $message): void { if (!$condition) { throw new RuntimeException($message); } };
$path = tempnam('/tmp', 'storm-status-');
$source = json_decode(file_get_contents('/opt/storm-forum/test/fixtures/minecraft-status.json'), true, 512, JSON_THROW_ON_ERROR);
try {
    file_put_contents($path, json_encode($source, JSON_THROW_ON_ERROR));
    $status = MinecraftStatus::read($path, 1005);
    $check($status['players'] === $source['players'] && $status['java']['state'] === 'online', 'Fresh public roster differs');
    $check($status['connections']['java']['address'] === 'ts-mc.net' && $status['connections']['bedrock'] === ['host'=>'mc.ts-mc.net', 'port'=>30004], 'Connection metadata differs');
    $check(!str_contains(json_encode($status), 'svc.cluster.local'), 'Public response exposed internal metadata');
    $stale = MinecraftStatus::read($path, 1181);
    $check($stale['state'] === 'unavailable' && $stale['players'] === null && $stale['java']['state'] === 'unavailable' && $stale['java']['version'] === '26.2', 'Stale cache exposed live players or lost verified versions');
    $check(MinecraftStatus::read($path, 900)['players'] === null, 'Future cache exposed players');
    file_put_contents($path, '{"state":"online","checkedAt":1000,"online":3,"maximum":20}');
    $check(MinecraftStatus::read($path, 1005)['players'] === null, 'Legacy unfiltered cache exposed a roster');
    $invalid = $source; $invalid['players']['names'] = ['<unsafe>'];
    file_put_contents($path, json_encode($invalid));
    $failed = false;
    try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
    $check($failed, 'Corrupt names did not fail validation');
    unlink($path);
    $check(MinecraftStatus::read($path)['state'] === 'unavailable', 'Missing initial cache was not unavailable');
} finally { if (is_file($path)) { unlink($path); } }
echo "Public Minecraft cache, staleness, migration, validation and connection metadata passed.\n";
