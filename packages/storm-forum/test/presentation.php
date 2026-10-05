<?php
// Native controller regressions in the disposable licensed fixture; no tokens leave memory.
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, 'Presentation fixture failed: ' . get_class($error) . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
$check = static function (bool $condition, string $message): void { if (!$condition) { throw new RuntimeException($message); } };
$nodes = $app->registry()->get('stormForumMap');
$guest = $app->repository('XF:User')->getGuestUser();
$staff = $app->em()->find('XF:User', 1);
$request = $app->request();
$controller = $app->controller(Storm\Forum\Pub\Controller\Theme::class, $request);
$request->set('forum', $nodes['node:reports']);
$request->set('theme', 'halloween');
$reply = XF::asVisitor($staff, fn() => $controller->actionCard());
$check($reply->getResponseCode() === 404, 'Staff request exposed a private forum share card');
$request->set('forum', $nodes['node:general']);
$request->set('theme', '');
$reply = XF::asVisitor($guest, fn() => $controller->actionCard());
$check($reply instanceof XF\Mvc\Reply\Redirect && str_contains($reply->getUrl(), 'theme=' . $app->registry()->get('stormForumSeason')), 'Public share card did not use the calendar');
$reply = XF::asVisitor($guest, fn() => $controller->actionPreferences());
$data = $reply->getParam('data');
$check($data['preferences']['appearance'] === 'system', 'Fresh guest appearance is not System');
$cookie = XF::generateRandomString(16);
$token = XF::$time . ',' . ($app['csrf.validator'])($cookie, XF::$time);
$posted = ['storm_mode'=>'system', 'storm_theme'=>'auto', 'storm_effects'=>'0', 'storm_preferences_api'=>'1', 't'=>$token];
$postRequest = new XF\Http\Request(new XF\InputFilterer(), $posted, [], ['csrf'=>$cookie], ['REQUEST_METHOD'=>'POST', 'HTTP_HOST'=>'127.0.0.1', 'REQUEST_URI'=>'/storm-theme/preferences']);
$misc = $app->controller(XF\Pub\Controller\MiscController::class, $postRequest);
$reply = XF::asVisitor($guest, fn() => $misc->actionStyle());
$check($reply instanceof XF\Mvc\Reply\View && $reply->getResponseType() === 'json', 'Guest preferences did not save through the native handler');
$check($reply->getParam('data')['preferences'] === ['version'=>1, 'appearance'=>'system', 'theme'=>'auto', 'effects'=>false], 'Saved preferences do not match the request');
$member = $app->finder('XF:User')->where('username', 'LocalAuthor')->fetchOne();
$selection = $member->style_id;
try {
    $member->style_id = 1; $member->save();
    $preferences = XF::asVisitor($member, fn() => $app->service('Storm\Forum:Preferences')->current());
    $check(in_array($preferences['appearance'], ['system','light','dark'], true) && $preferences['theme'] === 'auto', 'Existing native style could not share appearance preferences');
    $check($app->db()->fetchOne('SELECT style_id FROM xf_user WHERE user_id = ?', $member->user_id) == 1, 'Reading preferences changed an existing native style');
} finally { $member->style_id = $selection; $member->save(); }
echo "Guest System saves, effects preferences, public calendar cards, and staff-requested private-card exclusion passed.\n";
