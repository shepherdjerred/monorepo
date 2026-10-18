<?php
// Fixed read-only native checks while this release still owns maintenance.
require '/app/forum/src/XF.php';
XF::start('/app/forum');
$app = XF::setupApp('XF\Cli\App');
$app->start();
$manifest = (require '/opt/storm-forum/runtime/manifest.php')();
$version = $app->db()->fetchOne("SELECT version_string FROM xf_addon WHERE addon_id = 'XF'");
if ($version !== $manifest['xenforoVersion'] || \XF::$version !== $version
    || !$app->registry()->get('stormForumConfigured')) {
    throw new RuntimeException('Native forum identity or configuration is unsettled');
}
$addOn = $app->addOnManager()->getById('Storm/Forum');
if (!$addOn || $addOn->canInstall() || $addOn->canUpgrade()) {
    throw new RuntimeException('Native forum add-on migration is unsettled');
}
$templates = $app->db()->fetchOne("SELECT COUNT(*) FROM xf_template_map WHERE style_id = ? AND type = 'public' AND title IN ('PAGE_CONTAINER', 'storm_portal')", $app->options()->defaultStyleId);
if ((int) $templates !== 2) { throw new RuntimeException('Native forum templates are unsettled'); }
echo "verified\n";
