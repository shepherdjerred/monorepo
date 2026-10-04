<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
require __DIR__ . '/style-archive.php';
$manifest = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
if (XF::$version !== $manifest['xenforoVersion']) { throw new RuntimeException('Private XenForo version does not match the release'); }
foreach ($manifest['vendorDependencies'] as $dependency) {
    if ($dependency['kind'] === 'style') { stormValidateStyleArchive('/app/forum/' . $dependency['path'], $dependency); }
}
echo "Private Flexile archives match their pinned release and XenForo version.\n";
