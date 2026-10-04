<?php
// Runs only in a disposable container with EmptyDir-style application storage.
$check = static function (bool $condition): void {
    if (!$condition) { throw new RuntimeException('Assembly retry fixture failed'); }
};
$zip = new ZipArchive();
$check($zip->open('/tmp/assembly.zip', ZipArchive::CREATE | ZipArchive::OVERWRITE) === true);
foreach (['src/XF.php', 'src/XF/App.php', 'index.php', 'cmd.php', 'data/.htaccess'] as $path) {
    $check($zip->addFromString($path, 'local fixture'));
}
$check($zip->close());
$sha = hash_file('sha256', '/tmp/assembly.zip');
$assemble = static function () use ($check, $sha): void {
    $process = proc_open(['php', '/opt/storm-forum/runtime/assemble.php', '/tmp/assembly.zip', $sha], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($process)) { throw new RuntimeException('Cannot start assembly fixture'); }
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    $check(proc_close($process) === 0);
};
$assemble();
file_put_contents('/var/lib/storm-forum/data/attachment.txt', 'preserve attachment');
file_put_contents('/var/lib/storm-forum/internal_data/private.txt', 'preserve private file');
$assemble();
// Simulate interruption after the symlink was created but before the marker.
unlink('/app/forum/.storm-assembly');
file_put_contents('/app/forum/partial.txt', 'incomplete');
$assemble();
$check(!file_exists('/app/forum/partial.txt'));
$check(is_link('/app/forum/data'));
$check(file_get_contents('/var/lib/storm-forum/data/attachment.txt') === 'preserve attachment');
$check(file_get_contents('/var/lib/storm-forum/internal_data/private.txt') === 'preserve private file');
echo "Assembly repeat and interrupted retry preserved persistent files.\n";
