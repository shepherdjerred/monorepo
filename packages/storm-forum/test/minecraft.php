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
    $check(MinecraftStatus::read($path, 1180)['players'] === null, 'Roster survived its exact stale deadline');
    $check(MinecraftStatus::read($path, 900)['players'] === null, 'Future cache exposed players');
    file_put_contents($path, '{"state":"online","checkedAt":1000,"online":3,"maximum":20}');
    $check(MinecraftStatus::read($path, 1005)['players'] === null, 'Legacy unfiltered cache exposed a roster');
    $invalid = $source; $invalid['players']['names'] = ['<unsafe>'];
    file_put_contents($path, json_encode($invalid));
    $failed = false;
    try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
    $check($failed, 'Corrupt names did not fail validation');
    $offline = $source; $offline['state'] = 'unavailable'; $offline['java']['state'] = 'unavailable'; unset($offline['players']);
    file_put_contents($path, json_encode($offline));
    $check(MinecraftStatus::read($path, 1005)['players'] === null, 'Absent offline roster was rejected');
    $offline['players'] = null;
    file_put_contents($path, json_encode($offline));
    $failed = false;
    try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
    $check($failed, 'Explicit null roster did not fail validation');
    foreach (['top', 'java', 'bedrock', 'players'] as $level) {
        $invalid = $source;
        if ($level === 'top') { $invalid['unexpected'] = true; } else { $invalid[$level]['unexpected'] = true; }
        file_put_contents($path, json_encode($invalid));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Unknown field did not fail validation at ' . $level);
    }
    foreach ([['schemaVersion'=>null], ['online'=>null], ['maximum'=>-1], ['online'=>9007199254740992], ['unexpected'=>true]] as $extra) {
        file_put_contents($path, json_encode(['state'=>'online', 'checkedAt'=>1000] + $extra));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Corrupt legacy cache was accepted');
    }
    foreach (['java', 'bedrock'] as $edition) {
        foreach (['version', 'verifiedAt'] as $field) {
            $invalid = $source; unset($invalid[$edition][$field]);
            file_put_contents($path, json_encode($invalid));
            $failed = false;
            try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
            $check($failed, 'Incomplete edition metadata did not fail validation');
        }
        $invalid = $source; unset($invalid[$edition]['version'], $invalid[$edition]['verifiedAt']);
        file_put_contents($path, json_encode($invalid));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Online edition without metadata did not fail validation');
    }
    $numericNames = $source; $numericNames['players']['names'] = ['123', '0123', '1e3', '1000'];
    file_put_contents($path, json_encode($numericNames));
    $check(MinecraftStatus::read($path, 1005)['players']['names'] === $numericNames['players']['names'], 'Distinct numeric player names were collapsed');
    foreach (['😀', 'é'] as $character) {
        $name = str_repeat($character, 64);
        $unicode = $source; $unicode['players']['names'] = [$name]; $unicode['java']['version'] = str_repeat($character, 100);
        file_put_contents($path, json_encode($unicode));
        $check(MinecraftStatus::read($path, 1005)['players']['names'] === [$name], 'Valid Unicode code-point length boundary was rejected');
    }
    foreach (['name', 'version'] as $field) {
        $unicode = $source;
        if ($field === 'name') { $unicode['players']['names'] = [str_repeat('😀', 65)]; } else { $unicode['java']['version'] = str_repeat('😀', 101); }
        file_put_contents($path, json_encode($unicode));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Unicode code-point length overflow was accepted for ' . $field);
    }
    $empty = $source; $empty['players']['names'] = [];
    file_put_contents($path, json_encode($empty));
    $check(MinecraftStatus::read($path, 1005)['players']['names'] === [], 'Empty JSON names array was rejected');
    foreach ([(object)[], (object)['0'=>'Jerred']] as $names) {
        $invalid = $source; $invalid['players']['names'] = $names;
        file_put_contents($path, json_encode($invalid));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Object-shaped JSON names were accepted as an array');
    }
    $integral = $source; $integral['schemaVersion'] = 2.0; $integral['checkedAt'] = 1000.0;
    $integral['java']['verifiedAt'] = 1000.0; $integral['bedrock']['verifiedAt'] = 1000.0; $integral['players']['maximum'] = 20.0;
    file_put_contents($path, json_encode($integral, JSON_PRESERVE_ZERO_FRACTION));
    $check(MinecraftStatus::read($path, 1005)['players'] === $source['players'], 'Integral JSON numbers were rejected or not normalized');
    foreach (['checkedAt', 'java', 'bedrock', 'players'] as $field) {
        $invalid = $source;
        if ($field === 'checkedAt') { $invalid[$field] = 9007199254740992; }
        elseif ($field === 'players') { $invalid[$field]['maximum'] = 9007199254740992; }
        else { $invalid[$field]['verifiedAt'] = 9007199254740992; }
        file_put_contents($path, json_encode($invalid));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Unsafe JSON integer was accepted for ' . $field);
    }
    foreach ([1000.5, '1000'] as $value) {
        $invalid = $source; $invalid['checkedAt'] = $value;
        file_put_contents($path, json_encode($invalid));
        $failed = false;
        try { MinecraftStatus::read($path, 1005); } catch (RuntimeException $error) { $failed = true; }
        $check($failed, 'Non-integer timestamp was accepted');
    }
    unlink($path);
    $check(MinecraftStatus::read($path)['state'] === 'unavailable', 'Missing initial cache was not unavailable');
} finally { if (is_file($path)) { unlink($path); } }
echo "Public Minecraft cache, staleness, migration, validation and connection metadata passed.\n";
