<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\\Install\\App'); $app->start();
if ((new XF\Install\Helper($app))->isInstalled()) {
    $version = $app->db()->fetchOne("SELECT version_string FROM xf_addon WHERE addon_id = 'XF'");
    if (!is_string($version) || $version === '') { throw new RuntimeException('Installed XenForo version is missing.'); }
    echo json_encode(['state'=>'installed', 'xenforoVersion'=>$version], JSON_THROW_ON_ERROR) . "\n";
} elseif ($app->db()->fetchOne('SHOW TABLES')) {
    throw new RuntimeException('Incomplete installation: inspect before releasing.');
} else {
    echo json_encode(['state'=>'empty'], JSON_THROW_ON_ERROR) . "\n";
}
