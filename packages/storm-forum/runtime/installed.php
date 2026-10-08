<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\\Install\\App'); $app->start();
if ((new XF\Install\Helper($app))->isInstalled()) {
    echo "installed\n";
} elseif ($app->db()->fetchOne("SHOW TABLES LIKE 'xf_user'")) {
    throw new RuntimeException('Incomplete installation: inspect before releasing.');
} else {
    echo "empty\n";
}
