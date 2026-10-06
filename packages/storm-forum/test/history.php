<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
$check = static function (bool $condition, string $message): void { if (!$condition) { throw new RuntimeException($message); } };
$console = require '/opt/storm-forum/runtime/console.php';
$run = static function (array $options = []) use ($console): void {
    $input = new Symfony\Component\Console\Input\ArrayInput($options); $input->setInteractive(false);
    $check = $console->find('storm:history')->run($input, new Symfony\Component\Console\Output\NullOutput());
    if ($check !== 0) { throw new RuntimeException('History import failed'); }
    stormConsoleCleanup();
};
$users = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user');
$run();
$map = $app->registry()->get('stormForumHistory');
$check(count($map) === 120, 'Restored thread count differs from reviewed corpus');
$identities = $app->registry()->get('stormForumHistoricalUsers');
$check(count($identities) === 73, 'Historical aliases were not merged by original member ID');
$afterUsers = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user');
$run();
$check($afterUsers == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user'), 'Repeat history import created duplicate profiles');
$threads = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread');
try {
    // Simulate another process committing after this process cached an empty import map.
    $app->registry()->set('stormForumHistory', []);
    (new XF\DataRegistry($app->db()))->set('stormForumHistory', $map);
    $run();
    $check($threads == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread'), 'Stale registry cache duplicated a completed import');
} finally { $app->registry()->set('stormForumHistory', $map); }
$corpus = json_decode(file_get_contents('/opt/storm-forum/config/history.json'), true, 512, JSON_THROW_ON_ERROR);
$guest = $app->repository('XF:User')->getGuestUser();
$member = $app->finder('XF:User')->where('username', 'LocalAuthor')->fetchOne();
// Reproduce an actual v1 guest import: unchanged messages upgrade, while staff edits survive.
$legacy = json_decode(file_get_contents('/opt/storm-forum/test/fixtures/legacy-posts.json'), true, 512, JSON_THROW_ON_ERROR);
$saved = [];
try {
    $oldMap = $map; $oldMap[42]['version'] = 1;
    foreach ($legacy as $index=>$item) {
        unset($oldMap[42]['messageHashes'][$item['key']]);
        $post = $app->em()->find('XF:Post', $map[42]['posts'][$item['key']]);
        $saved[$post->post_id] = ['message'=>$post->message, 'user_id'=>$post->user_id];
        $post->user_id = 0; $post->message = $item['message'] . ($index ? "\nStaff edit before migration." : ''); $post->save();
    }
    $app->registry()->set('stormForumHistory', $oldMap); $run();
    foreach ($legacy as $index=>$item) {
        $post = $app->em()->find('XF:Post', $map[42]['posts'][$item['key']]);
        $check($post->user_id === $identities[$corpus['threads'][array_search(42, array_column($corpus['threads'], 'originalId'))]['posts'][$index]['originalUserId']]['userId'], 'v1 guest post was not assigned its native profile');
        $expected = $index ? $item['message'] . "\nStaff edit before migration." : $saved[$post->post_id]['message'];
        $check($post->message === $expected, 'Migration lost recovered formatting or overwrote a staff edit');
    }
    $check(count($app->registry()->get('stormForumHistory')[42]['conflicts'] ?? []) === 1, 'Migration did not report the edited message');
    // Ordinary release refuses unknown revisions; explicit migration retains native IDs.
    $changed = $app->registry()->get('stormForumHistory'); $changed[42]['hash'] = str_repeat('0', 64);
    $app->registry()->set('stormForumHistory', $changed);
    $rejected = false;
    try { $run(); } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'explicit migration'); }
    $check($rejected, 'Unreviewed corpus revision was silently applied');
    $run(['--migrate'=>true]);
    $check($app->registry()->get('stormForumHistory')[42]['posts'] === $map[42]['posts'], 'Explicit migration changed native post IDs');
} finally {
    foreach ($saved as $id=>$values) { $post = $app->em()->find('XF:Post', $id); $post->bulkSet($values); $post->save(); }
    $app->registry()->set('stormForumHistory', $map);
    $app->em()->clearEntityCache();
}
foreach ($corpus['users'] as $item) {
    $user = $app->em()->find('XF:User', $identities[$item['originalId']]['userId'], ['Auth','Privacy']);
    $check($user->username === $item['username'] && $user->email === '', 'Historical identity was fabricated or merged by name');
    $check(!$user->Auth->authenticate('invalid-test-password') && !$user->Auth->getAuthenticationHandler()->hasPassword(), 'Historical profile can authenticate');
    $check(!$user->is_staff && !$user->is_admin && !$user->is_moderator && $user->last_activity === 0, 'Historical profile has restored staff privileges or fake activity');
    $check(XF::asVisitor($guest, fn() => $user->canViewFullProfile()), 'Historical profile is not publicly visible');
    $check($user->message_count > 0, 'Historical profile post count missing');
    if ($item['avatar']) { $check($user->avatar_date > 0, 'Recovered avatar missing'); }
}
foreach ($corpus['threads'] as $record) {
    $thread = $app->em()->find('XF:Thread', $map[$record['originalId']]['threadId']);
    $check($thread->discussion_open && $thread->user_id === $identities[$record['posts'][0]['originalUserId']]['userId'], 'Restored discussion has incorrect native ownership');
    $check(XF::asVisitor($guest, fn() => $thread->canView()), 'Restored public discussion is not guest-visible');
    $check(XF::asVisitor($member, fn() => $thread->canReply()), 'Members cannot reply to a restored discussion');
    $check($thread->reply_count === count($record['posts']) - 1, 'Historical reply count is incorrect');
    foreach ($record['posts'] as $position=>$item) {
        $post = $app->em()->find('XF:Post', $map[$record['originalId']]['posts'][$item['key']]);
        $check($post->user_id === $identities[$item['originalUserId']]['userId'] && $post->username === $item['author'] && $post->post_date === $item['date'], 'Original attribution/date changed');
        $check($post->position === $position, 'Historical post ordering changed');
        foreach ($item['attachments'] as $original) {
            $native = $map[$record['originalId']]['attachments'][$item['key']][$original];
            $attachment = $app->em()->find('XF:Attachment', $native, ['Data']);
            $check($attachment->content_type === 'post' && $attachment->content_id === $post->post_id && !$attachment->unassociated, 'Recovered attachment has no native post association');
            $check($attachment->Data->width > 0 && $attachment->Data->thumbnail_width > 0, 'Recovered attachment image/thumbnail missing');
            $check(XF::asVisitor($guest, fn() => $attachment->canView()), 'Recovered public attachment is not guest-visible');
        }
    }
}
$before = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_post');
$thread = $app->em()->find('XF:Thread', $map[42]['threadId'], ['FirstPost']);
$original = $thread->FirstPost->message;
$reply = null;
try {
    $thread->FirstPost->message = $original . "\nLocal staff edit acceptance."; $thread->FirstPost->save();
    $reply = XF::asVisitor($member, function () use ($app, $thread) {
        $creator = $app->service('XF:Thread\Replier', $thread);
        $creator->setMessage('Local reply acceptance.'); $creator->setIsAutomated();
        return $creator->save();
    });
    $run();
    $check($app->db()->fetchOne('SELECT COUNT(*) FROM xf_post') == $before + 1, 'Repeat import duplicated posts or removed a new reply');
    $check($app->db()->fetchOne('SELECT message FROM xf_post WHERE post_id = ?', $thread->first_post_id) === $original . "\nLocal staff edit acceptance.", 'Repeat import overwrote a staff edit');
} finally {
    if ($reply) { $reply->delete(); }
    $post = $app->em()->find('XF:Post', $thread->first_post_id); $post->message = $original; $post->save();
}
echo "73 public profile-only identities, 17 avatars, native attachments, original names/dates, 120 public discussions, 1,148 posts, v1 migration, explicit revision guard, replies, repeat import, and later edits passed.\n";
