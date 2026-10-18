<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
require __DIR__ . '/style-archive.php';
$manifest = (require '/opt/storm-forum/runtime/manifest.php')();
if (XF::$version !== $manifest['xenforoVersion']) { throw new RuntimeException('Private XenForo version does not match the release'); }
foreach ($manifest['vendorDependencies'] as $dependency) {
    if ($dependency['kind'] === 'style') { stormValidateStyleArchive('/app/forum/' . $dependency['path'], $dependency); }
}
echo "Private Flexile archives match their pinned release and XenForo version.\n";
