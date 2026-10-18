<?php
declare(strict_types=1);
// Dedicated observer capability: this handler cannot mutate forum or configuration.
header('Content-Type: application/json');
header('Cache-Control: no-store');
$expected = getenv('DELIVERY_FORUM_OBSERVATION_TOKEN');
if (!is_string($expected) || strlen($expected) < 32) {
    http_response_code(503);
    echo '{"error":"observation-not-provisioned"}';
    return;
}
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!is_string($authorization) || !hash_equals('Bearer ' . $expected, $authorization)) {
    http_response_code(401);
    echo '{"error":"unauthorized"}';
    return;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    http_response_code(405);
    echo '{"error":"read-only"}';
    return;
}
try {
    if (file_exists('/var/lib/storm-forum/.maintenance') || file_exists('/var/lib/storm-forum/.release-lock')) {
        throw new RuntimeException('Forum release is unsettled.');
    }
    $bundle = trim((string) file_get_contents('/app/forum/.storm-assembly'));
    if (!preg_match('/^[a-f0-9]{64}$/D', $bundle)) { throw new RuntimeException('Assembly identity missing.'); }
    require '/app/forum/src/XF.php';
    XF::start('/app/forum');
    $app = XF::setupApp('XF\\Install\\App');
    $app->start();
    if (!(new XF\Install\Helper($app))->isInstalled()) {
        throw new RuntimeException('Installed XenForo identity unavailable.');
    }
    $version = $app->db()->fetchOne("SELECT version_string FROM xf_addon WHERE addon_id = 'XF'");
    if (!is_string($version) || !preg_match('/^\d+\.\d+\.\d+$/D', $version)) {
        throw new RuntimeException('Installed XenForo identity unavailable.');
    }
    // Fence again after the DB read so a concurrent release cannot produce an apparently settled proof.
    clearstatcache();
    if (file_exists('/var/lib/storm-forum/.maintenance') || file_exists('/var/lib/storm-forum/.release-lock') || trim((string) file_get_contents('/app/forum/.storm-assembly')) !== $bundle) {
        throw new RuntimeException('Forum release changed during observation.');
    }
    echo json_encode(['schemaVersion' => 1, 'state' => 'installed', 'xenforoVersion' => $version, 'bundleSha256' => $bundle, 'maintenance' => false, 'releaseLock' => false], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    http_response_code(503);
    echo '{"error":"forum-unsettled"}';
}
