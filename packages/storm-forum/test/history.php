<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
$check = static function (bool $condition, string $message): void { if (!$condition) { throw new RuntimeException($message); } };
$console = require '/opt/storm-forum/runtime/console.php';
$run = static function () use ($console): void {
    $input = new Symfony\Component\Console\Input\ArrayInput([]); $input->setInteractive(false);
    $check = $console->find('storm:history')->run($input, new Symfony\Component\Console\Output\NullOutput());
    if ($check !== 0) { throw new RuntimeException('History import failed'); }
    stormConsoleCleanup();
};
$users = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user');
$run();
$map = $app->registry()->get('stormForumHistory');
$check(count($map) === 120, 'Restored thread count differs from reviewed corpus');
$check($users == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user'), 'History created former user accounts');
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
foreach ($corpus['threads'] as $record) {
    $thread = $app->em()->find('XF:Thread', $map[$record['originalId']]['threadId']);
    $check($thread->discussion_open && $thread->user_id === 0, 'Restored discussion is closed or owned by an account');
    $check(XF::asVisitor($guest, fn() => $thread->canView()), 'Restored public discussion is not guest-visible');
    $check(XF::asVisitor($member, fn() => $thread->canReply()), 'Members cannot reply to a restored discussion');
    $check($thread->reply_count === count($record['posts']) - 1, 'Historical reply count is incorrect');
    foreach ($record['posts'] as $position=>$item) {
        $post = $app->em()->find('XF:Post', $map[$record['originalId']]['posts'][$item['key']]);
        $check($post->user_id === 0 && $post->username === $item['author'] && $post->post_date === $item['date'], 'Original attribution/date changed');
        $check($post->position === $position, 'Historical post ordering changed');
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
echo "Historical authors/dates, 120 public active discussions, 1,148 ordered posts, native replies, account exclusion, repeat import, and later edits passed.\n";
