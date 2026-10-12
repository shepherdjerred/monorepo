<?php
// Shared by fresh-install preflight and the native CLI import. No database access.
function stormValidateStyleArchive(string $file, array $dependency): SimpleXMLElement
{
    if (!is_file($file) || !hash_equals($dependency['sha256'], hash_file('sha256', $file))) {
        throw new RuntimeException('Private style archive checksum mismatch: ' . $dependency['key']);
    }
    $zip = new ZipArchive();
    if ($zip->open($file) !== true) { throw new RuntimeException('Invalid private style archive'); }
    try {
        if (!XF\Util\File::validateZipEntryNames($zip)) { throw new RuntimeException('Unsafe private style archive paths'); }
        $xml = $zip->getFromName('style.xml');
        if ($xml === false) { throw new RuntimeException('Private style archive has no native XML'); }
        $document = XF\Util\Xml::open($xml);
    } finally { $zip->close(); }
    if ($document->getName() !== 'style'
        || (string)$document['export_version'] !== (string)XF\Service\Style\ExportService::EXPORT_VERSION_ID
        || (int)$document['base_version_id'] !== XF::$versionId
        || !in_array((string)$document['addon_id'], ['', 'XF'], true)
        || (string)$document['storm_flexile_version'] !== $dependency['version']
        || (string)$document['storm_flexile_mode'] !== $dependency['mode']
        || (string)$document['title'] !== 'Flexile · The Storm · ' . ucfirst($dependency['mode'])) {
        throw new RuntimeException('Private Flexile style metadata does not match the release: ' . $dependency['key']);
    }
    $templates = [];
    foreach ($document->templates->template as $template) { $templates[(string)$template['title']] = (string)$template; }
    if (!isset($templates['storm_flexile.less'], $templates['PAGE_CONTAINER'], $templates['storm_flexile_visitor'])
        || !str_contains($templates['PAGE_CONTAINER'], 'An Audentio Design design creation.')) {
        throw new RuntimeException('Private Flexile style is incomplete or missing attribution');
    }
    $properties = [];
    foreach ($document->properties->property as $property) { $properties[] = (string)$property['property_name']; }
    if (array_diff(['chromeBg', 'contentBg', 'fontFamilyBody', 'pageWidthMax', 'flexile_show_header_content', 'flexile_header_content', 'flexile_header_content_style', 'flexile_primaryBorderColor'], $properties)) {
        throw new RuntimeException('Private Flexile style is missing its native properties');
    }
    return $document;
}
