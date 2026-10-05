<?php
// Native entity/import acceptance, executed only inside the disposable local harness.
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App');
$app->start();
$catalog = \Storm\Forum\Service\ThemeCatalog::load(true);
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
    foreach (array_column($catalog['themes'], 'id') as $season) {
        $style = $app->em()->find('XF:Style', $map[$mode . ':' . $season]);
        $check($style->parent_id === $map['flexile-parent:' . $mode] && $style->user_selectable && !$style->enable_variations, 'Selectable style hierarchy is incorrect');
        $properties = $app->repository('XF:StyleProperty')->getEffectivePropertiesInStyle($style);
        $check($properties['contentBg']->getVariationValue('default') === ($mode === 'dark' ? '#2a2a2a' : '#ffffff'), 'Appearance palette did not reach the child');
        $check($properties['publicLogoUrl']->getVariationValue('default') === 'styles/storm/logo.svg', 'Logo property did not reach the child');
        $theme = \Storm\Forum\Service\ThemeCatalog::theme($season);
        $check($properties['chromeBg']->getVariationValue('default') === $theme['palettes'][$mode]['chromeBg'], 'Catalog palette did not reach the child');
        $check((bool)$properties['flexile_show_header_content']->property_value, 'Header content setting is not inherited');
    }
}
$check(count(array_filter(array_keys($map), fn($key) => preg_match('/^(light|dark):/', $key))) === 28, 'Managed catalog does not contain 28 selectable styles');
foreach (['light','dark'] as $mode) {
    $follower = $app->em()->find('XF:Style', $map[$mode . ':auto']);
    $check(!$app->finder('XF:StyleProperty')->where('style_id', $follower->style_id)->total(), 'Follower has local property snapshots');
    $check(!$app->finder('XF:Template')->where('style_id', $follower->style_id)->total(), 'Follower has local template snapshots');
}
$author->style_id = $map['dark:auto']; $author->save();
$policy = $app->service('Storm\Forum:SeasonPolicy');
$applyPolicy = static function (string $season, bool $follow) use ($policy): bool {
    $changed = $policy->apply($season, $follow);
    stormConsoleCleanup();
    return $changed;
};
$check($applyPolicy('halloween', true), 'Follower did not transition');
$check($app->options()->defaultStyleId == $map['light:auto'], 'Calendar default does not follow stable style');
$check(!$applyPolicy('halloween', true), 'Unchanged season rebuilt the style data');
$check($applyPolicy('thanksgiving', true), 'Next festival did not transition');
$darkFollower = $app->em()->find('XF:Style', $map['dark:auto']);
$check($darkFollower->parent_id === $map['dark:thanksgiving'] && $author->style_id === $map['dark:auto'], 'Follower lost dark member selection');
$effective = $app->repository('XF:StyleProperty')->getEffectivePropertiesInStyle($darkFollower);
$check($effective['chromeBg']->getVariationValue('default') === \Storm\Forum\Service\ThemeCatalog::theme('thanksgiving')['palettes']['dark']['chromeBg'], 'Follower palette retained previous parent values');
$brokenMap = $map; unset($brokenMap['dark:easter']);
$app->registry()->set('stormForumStyles', $brokenMap);
try { $applyPolicy('easter', false); throw new LogicException('Missing style was accepted'); }
catch (RuntimeException $error) { $check(str_contains($error->getMessage(), 'missing'), 'Wrong missing-style error'); }
$check($darkFollower->parent_id === $map['dark:thanksgiving'] && $app->options()->defaultStyleId == $map['light:auto'], 'Failed transition changed active appearance');
$app->registry()->set('stormForumStyles', $map);
$applyPolicy('christmas', false);
$author->style_id = $map['dark:halloween']; $author->save();
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
echo "Native Flexile migration, 28 managed styles, inherited palettes/logo/header properties, stable followers, repeat import, member selection, fail-closed transition, and archive preflight passed.\n";
