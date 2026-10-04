<?php
// Init-only. The private release archive never enters an image layer.
if ($argc !== 3 || !preg_match('/^[a-f0-9]{64}$/', $argv[2])) {
    throw new RuntimeException('Usage: assemble.php <private-archive.zip> <sha256>');
}
if (!hash_equals($argv[2], hash_file('sha256', $argv[1]))) { throw new RuntimeException('Private bundle checksum mismatch'); }
$zip = new ZipArchive();
if ($zip->open($argv[1]) !== true) { throw new RuntimeException('Invalid private archive'); }
// Validate the entire archive before writing a file. Refuse traversal, links, duplicates.
$paths = [];
for ($i = 0; $i < $zip->numFiles; $i++) {
    $name = $zip->getNameIndex($i);
    $zip->getExternalAttributesIndex($i, $opsys, $attributes);
    if ($name === '' || str_contains($name, '\\') || str_starts_with($name, '/') || preg_match('#(^|/)\.\.?(/|$)#', $name) || str_contains($name, ':') || (($attributes >> 16) & 0170000) === 0120000 || isset($paths[$name])) {
        throw new RuntimeException('Unsafe private archive entry');
    }
    $paths[$name] = true;
}
foreach (['src/XF.php', 'src/XF/App.php', 'index.php', 'cmd.php'] as $required) {
    if (!isset($paths[$required])) { throw new RuntimeException("Incomplete XenForo bundle: {$required}"); }
}
if (file_exists('/app/forum/src/XF.php')) { throw new RuntimeException('Application directory must be empty'); }
if (!$zip->extractTo('/app/forum')) { throw new RuntimeException('Private archive extraction failed'); }
$zip->close();
$copy = static function (string $source, string $target) use (&$copy): void {
    if (is_dir($source)) {
        if (!is_dir($target) && !mkdir($target, 0755, true)) { throw new RuntimeException('Cannot create application directory'); }
        foreach (new DirectoryIterator($source) as $file) {
            if (!$file->isDot()) { $copy($file->getPathname(), $target . '/' . $file->getFilename()); }
        }
    } elseif (!copy($source, $target)) { throw new RuntimeException('Cannot copy owned application file'); }
};
$copy('/opt/storm-forum/addon/Storm', '/app/forum/src/addons/Storm');
$copy('/opt/storm-forum/assets', '/app/forum/styles/storm');
$copy('/opt/storm-forum/runtime/config.php', '/app/forum/src/config.php');
foreach (['data', 'internal_data'] as $directory) {
    $target = '/var/lib/storm-forum/' . $directory;
    if (!is_dir($target) && !mkdir($target, 0750, true)) { throw new RuntimeException('Cannot initialize writable storage'); }
}
// XenForo distributes data/.htaccess; copy its safe contents before replacing the directory.
$copy('/app/forum/data', '/var/lib/storm-forum/data');
foreach (new DirectoryIterator('/app/forum/data') as $file) {
    if (!$file->isDot() && $file->isFile()) { unlink($file->getPathname()); }
}
if (!rmdir('/app/forum/data') || !symlink('/var/lib/storm-forum/data', '/app/forum/data')) {
    throw new RuntimeException('Cannot link attachment storage');
}
echo "Private application assembled.\n";
