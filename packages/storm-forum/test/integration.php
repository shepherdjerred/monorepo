<?php
// Runs only against the disposable local installation, never a deployed forum.
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void {
    fwrite(STDERR, (string)$error . "\n");
    exit(1);
});
$app = XF::setupApp('XF\Cli\App');
$app->start();
$check = static function (bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
};
$map = $app->registry()->get('stormForumMap');
$check(count(array_filter(array_keys($map), fn($key) => str_starts_with($key, 'node:'))) === 13, 'Managed node count incorrect');
$before = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_node');
$app->service('Storm\Forum:Configuration')->apply(json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR), 'beta');
$check($before == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_node'), 'Repeat configuration created duplicate nodes');
$check($map === $app->registry()->get('stormForumMap'), 'Repeat configuration changed stable IDs');
$check($app->options()->registrationSetup['enabled'] === false, 'Registration must begin closed');
foreach (['POSTAL_SMTP_PASSWORD', 'TURNSTILE_SECRET_KEY'] as $key) {
    $check(!str_contains($app->db()->fetchOne('SELECT GROUP_CONCAT(option_value) FROM xf_option'), getenv($key)), 'Credential leaked into options');
}
echo "Configuration repeatability and secret storage assertions passed.\n";
$makeUser = static function (string $name) use ($app) {
    $existing = $app->finder('XF:User')->where('username', $name)->fetchOne();
    if ($existing) { return $existing; }
    $user = $app->repository('XF:User')->setupBaseUser();
    $user->username = $name;
    $user->email = strtolower($name) . '@example.test';
    $user->user_state = 'valid';
    $user->Auth->setPassword(bin2hex(random_bytes(32)));
    $user->save();
    return $user;
};
$author = $makeUser('LocalAuthor');
$other = $makeUser('LocalOther');
$staff = $app->em()->find('XF:User', 1);
$guest = $app->repository('XF:User')->getGuestUser();
$forum = $app->em()->find('XF:Forum', $map['node:reports']);
$thread = XF::asVisitor($author, function () use ($app, $forum) {
    $creator = $app->service('XF:Thread\Creator', $forum);
    $creator->setContent('PRIVATE-SUPPORT-TEST', 'Private report used only in the disposable integration test.');
    $creator->setIsAutomated();
    $creator->setDiscussionState('visible');
    return $creator->save();
});
foreach ([[$guest, false], [$author, true], [$other, false], [$staff, true]] as [$visitor, $expected]) {
    $check(XF::asVisitor($visitor, fn() => $thread->canView()) === $expected, 'Private support visibility incorrect for ' . $visitor->username);
}
$staffForum = $app->em()->find('XF:Forum', $map['node:staff']);
$check(!XF::asVisitor($author, fn() => $staffForum->canView()), 'Member can view staff forum');
$check(XF::asVisitor($staff, fn() => $staffForum->canView()), 'Staff cannot view staff forum');
$check(!XF::asVisitor($author, fn() => $app->em()->find('XF:Forum', $map['node:news'])->canCreateThread()), 'Member can create an announcement');
$check(!$author->hasPermission('general', 'submitWithoutApproval'), 'New account can bypass approval');
$check(!$author->hasPermission('conversation', 'start'), 'New account can start messages');
$promotion = $app->em()->find('XF:UserGroupPromotion', $map['promotion:trusted']);
$criteria = $app->criteria('XF:User', $promotion->user_criteria);
$author->message_count = 2;
$author->register_date = time() - 86401;
$check(!$criteria->isMatched($author), 'Two approved posts qualified');
$author->message_count = 3;
$author->register_date = time() - 3600;
$check(!$criteria->isMatched($author), 'Young account qualified');
$author->register_date = time() - 86401;
$check($criteria->isMatched($author), 'Established account did not qualify');
echo "Author/staff privacy, announcement permissions, approval and promotion assertions passed.\n";
$new = $makeUser('LocalModeration' . bin2hex(random_bytes(3)));
$new->register_date = time() - 86401;
$new->save();
$general = $app->em()->find('XF:Forum', $map['node:general']);
$threads = [];
for ($index = 1; $index <= 3; $index++) {
    $candidate = XF::asVisitor($new, function () use ($app, $general, $index) {
        $creator = $app->service('XF:Thread\Creator', $general);
        $creator->setContent('Local moderation fixture ' . $index, 'A post in the disposable test installation.');
        return $creator->save();
    });
    $threads[] = $candidate;
    $check($candidate->discussion_state === 'moderated', 'A new account post was published without approval');
    $check($new->message_count === $index - 1, 'An unapproved post increased the promotion count');
    $candidate->discussion_state = 'visible';
    $candidate->save();
    $check($new->message_count === $index, 'Approved post did not increase the promotion count');
    $app->repository('XF:UserGroupPromotion')->updatePromotionsForUser($new);
    $check(in_array($map['group:trusted'], $new->secondary_group_ids, true) === ($index === 3), 'Promotion did not match actual approved posts');
}
foreach ($threads as $candidate) { $candidate->delete(); }
echo "Actual pending-post counts, staff approval, and third-post promotion passed.\n";
