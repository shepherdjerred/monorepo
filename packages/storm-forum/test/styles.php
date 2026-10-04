<?php
// Native entity/import acceptance, executed only inside the disposable local harness.
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App');
$app->start();
$console = require '/opt/storm-forum/runtime/console.php';
require_once '/opt/storm-forum/runtime/style-archive.php';
$check = static function (bool $condition, string $message): void { if (!$condition) { throw new RuntimeException($message); } };
$run = static function () use ($console): void {
    $input = new Symfony\Component\Console\Input\ArrayInput([]);
    $input->setInteractive(false);
    if ($console->find('storm:styles')->run($input, new Symfony\Component\Console\Output\NullOutput()) !== 0) { throw new RuntimeException('Native style import failed'); }
    stormConsoleCleanup();
};
$map = $app->registry()->get('stormForumStyles') ?: [];
if (!$map) {
    // An old registry can already contain selectable children; their IDs must survive a parent switch.
    foreach (['light', 'dark'] as $mode) { $app->service('Storm\Forum:OwnedStyles')->apply($app->em()->find('XF:Style', 1), $mode, $map); }
    stormConsoleCleanup();
}
$childIds = array_intersect_key($map, array_flip(['light:normal', 'dark:normal', 'light:halloween', 'dark:halloween', 'light:christmas', 'dark:christmas']));
$run();
$map = $app->registry()->get('stormForumStyles');
$check(count($childIds) === 6 && array_intersect_key($map, $childIds) === $childIds, 'Parent migration changed child style IDs');
$before = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_style');
$author = $app->finder('XF:User')->where('username', 'LocalAuthor')->fetchOne();
$selection = $author->style_id;
$author->style_id = $map['dark:halloween'];
$author->save();
$app->registry()->set('stormForumSeason', 'christmas');
$run();
$check($app->registry()->get('stormForumStyles') === $map, 'Repeat import changed style registry');
$check($before == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_style'), 'Repeat import created duplicate styles');
$check($app->options()->defaultStyleId == $map['light:christmas'], 'Import lost the active season');
$check($app->db()->fetchOne('SELECT style_id FROM xf_user WHERE user_id = ?', $author->user_id) == $map['dark:halloween'], 'Import changed a member selection');
foreach (['light', 'dark'] as $mode) {
    foreach (['normal', 'halloween', 'christmas'] as $season) {
        $style = $app->em()->find('XF:Style', $map[$mode . ':' . $season]);
        $check($style->parent_id === $map['flexile-parent:' . $mode] && $style->user_selectable && !$style->enable_variations, 'Selectable style hierarchy is incorrect');
        $properties = $app->repository('XF:StyleProperty')->getEffectivePropertiesInStyle($style);
        $check($properties['contentBg']->getVariationValue('default') === ($mode === 'dark' ? '#2a2a2a' : '#ffffff'), 'Appearance palette did not reach the child');
        $check($properties['publicLogoUrl']->getVariationValue('default') === 'styles/storm/logo.svg', 'Logo property did not reach the child');
    }
}
$dependencies = array_values(array_filter(json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true)['vendorDependencies'], fn($dependency) => $dependency['kind'] === 'style'));
$darkFile = '/app/forum/' . $dependencies[1]['path'];
$original = file_get_contents($darkFile);
try {
    file_put_contents($darkFile, $original . 'changed');
    try { $run(); throw new LogicException('Altered second archive was accepted'); }
    catch (RuntimeException $error) { $check(str_contains($error->getMessage(), 'checksum mismatch'), 'Wrong altered-archive failure'); }
    $check($before == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_style') && $app->registry()->get('stormForumStyles') === $map, 'Failed preflight imported the first archive');
} finally { file_put_contents($darkFile, $original); }
$file = '/tmp/storm-forum/invalid-style.zip';
$document = stormValidateStyleArchive('/app/forum/' . $dependencies[0]['path'], $dependencies[0]);
foreach (['base_version_id' => '99999999', 'storm_flexile_version' => '9.0.0', 'storm_flexile_mode' => 'dark'] as $attribute => $invalid) {
    $copy = XF\Util\Xml::open($document->asXML());
    $copy[$attribute] = $invalid;
    $zip = new ZipArchive();
    $zip->open($file, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('style.xml', $copy->asXML());
    $zip->close();
    $dependency = $dependencies[0];
    $dependency['sha256'] = hash_file('sha256', $file);
    try { stormValidateStyleArchive($file, $dependency); throw new LogicException('Incompatible metadata was accepted'); }
    catch (RuntimeException $error) { $check(str_contains($error->getMessage(), 'metadata'), 'Wrong incompatible-metadata failure'); }
}
unlink($file);
$author->style_id = $selection;
$author->save();
$app->registry()->set('stormForumSeason', 'normal');
$run();
echo "Native Flexile migration, six palettes/logo properties, repeat import, member selection, seasonal default, and archive preflight passed.\n";
