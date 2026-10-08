<?php
// Native account/retirement regressions run only in the disposable licensed fixture.
require '/app/forum/src/XF.php'; XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
$check = static function (bool $ok, string $message): void { if (!$ok) { throw new RuntimeException($message); } };
$console = require '/opt/storm-forum/runtime/console.php';
$run = static function (string $name, array $options = []) use ($console): void {
    $input = new Symfony\Component\Console\Input\ArrayInput($options); $input->setInteractive(false);
    if ($console->find($name)->run($input, new Symfony\Component\Console\Output\NullOutput()) !== 0) { throw new RuntimeException('Native command failed'); }
    stormConsoleCleanup();
};
$target = $app->em()->find('XF:User', 1, ['Auth']);
$source = $app->em()->find('XF:User', $app->registry()->get('stormForumHistoricalUsers')[1]['userId']);
$sourceId = $source->user_id;
$merger = $app->service('XF:User\Merge');
$check($merger instanceof Storm\Forum\Service\UserMerge, 'Native ACP/job merge bypasses the archive integration');
$merger->setSource($source)->setTarget($source); $merger->merge();
$check(empty($app->registry()->get('stormForumHistoricalUsers')[1]['claimed']), 'A self merge claimed an archive');
$rejected = false;
try { $merger = $app->service('XF:User\Merge'); $merger->setSource($target)->setTarget($source); $merger->merge(); }
catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'not the reverse'); }
$check($rejected, 'An active login could be merged into a profile-only account');
$name = $target->username; $target->setOption('admin_edit', true); $target->username = 'Jerred'; $target->save();
$credentials = $app->db()->fetchRow('SELECT email,is_admin,is_moderator,is_staff FROM xf_user WHERE user_id = 1');
$auth = $app->db()->fetchRow('SELECT * FROM xf_user_authenticate WHERE user_id = 1');
$tfa = $app->db()->fetchAll('SELECT * FROM xf_user_tfa WHERE user_id = 1');
$posts = $app->db()->fetchAll('SELECT post_id,username,message,post_date FROM xf_post WHERE user_id = ? ORDER BY post_id', $sourceId);
$media = $app->db()->fetchAll('SELECT attachment_id,data_id,content_id,content_type FROM xf_attachment ORDER BY attachment_id');
$seeds = json_decode(file_get_contents('/opt/storm-forum/config/seed-content.json'), true, 512, JSON_THROW_ON_ERROR);
$nodes = $app->registry()->get('stormForumMap'); $published = [];
XF::asVisitor($target, function () use ($app, $nodes, $seeds, &$published) {
    foreach ($seeds as $seed) {
        $creator = $app->service('XF:Thread\Creator', $app->em()->find('XF:Forum', $nodes['node:' . $seed['node']]));
        $creator->setContent($seed['title'], $seed['message']); $creator->setIsAutomated();
        $published[$seed['key']] = $creator->save()->thread_id;
    }
});
$app->registry()->set('stormForumSeedThreads', $published);
$run('storm:seed'); $run('storm:seed');
foreach ($published as $id) { $check($app->em()->find('XF:Thread', $id)->discussion_state === 'deleted', 'Generated launch thread remains visible'); }
$check(count($app->registry()->get('stormForumRetiredSeeds')) === 3, 'Seed retirement is not permanent');
// Roll back a native merge failure even after native finalization deleted the donor.
$failing = new class($app) extends Storm\Forum\Service\UserMerge {
    protected function stepFinalizeMerge() { parent::stepFinalizeMerge(); throw new RuntimeException('fixture rollback'); }
};
$failing->setSource($source)->setTarget($target);
try { $failing->merge(); throw new LogicException('Merge failure fixture did not throw'); }
catch (RuntimeException $error) { $check($error->getMessage() === 'fixture rollback', 'Unexpected account merge failure'); }
$check(!$app->db()->inTransaction() && $app->db()->fetchOne('SELECT user_id FROM xf_user WHERE user_id = ?', $sourceId), 'Failed native merge left a transaction or deleted its source');
$check($posts === $app->db()->fetchAll('SELECT post_id,username,message,post_date FROM xf_post WHERE user_id = ? ORDER BY post_id', $sourceId), 'Failed native merge changed historical posts');
$check(!$app->registry()->get('stormForumHistoricalMerge'), 'Failed native merge left a pending import lock');
$run('storm:accounts', ['--stage'=>'prod']); $run('storm:accounts', ['--stage'=>'prod']);
$entry = $app->registry()->get('stormForumHistoricalUsers')[1];
$check($entry['claimed'] && $entry['userId'] === 1 && in_array($sourceId, $entry['retiredUserIds'], true), 'Completed account merge lost its archive mapping');
$check(!$app->db()->fetchOne('SELECT user_id FROM xf_user WHERE user_id = ?', $sourceId), 'Native donor still exists after the merge');
$check($credentials === $app->db()->fetchRow('SELECT email,is_admin,is_moderator,is_staff FROM xf_user WHERE user_id = 1') && $auth === $app->db()->fetchRow('SELECT * FROM xf_user_authenticate WHERE user_id = 1') && $tfa === $app->db()->fetchAll('SELECT * FROM xf_user_tfa WHERE user_id = 1'), 'Surviving login, staff rights or TFA changed');
foreach ($posts as $post) {
    $native = $app->db()->fetchRow('SELECT post_id,username,message,post_date FROM xf_post WHERE post_id = ? AND user_id = 1', $post['post_id']);
    $check($post === $native, 'Combined historical post lost its name, date or formatting');
}
$check($media === $app->db()->fetchAll('SELECT attachment_id,data_id,content_id,content_type FROM xf_attachment ORDER BY attachment_id'), 'Account merge changed attachment association');
$count = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_post'); $run('storm:history'); $run('storm:seed');
$check($count == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_post') && $app->registry()->get('stormForumHistoricalUsers')[1] === $entry, 'Repeat release recreated profiles, posts or seeds');
$portal = $app->controller(Storm\Forum\Pub\Controller\Portal::class, $app->request());
$guest = $app->repository('XF:User')->getGuestUser();
$app->request()->set('page', 1); $first = XF::asVisitor($guest, fn() => $portal->actionIndex());
$app->request()->set('page', 2); $second = XF::asVisitor($guest, fn() => $portal->actionIndex());
$firstIds = array_keys($first->getParam('news')->toArray()); $secondIds = array_keys($second->getParam('news')->toArray());
$check(count($firstIds) === 12 && count($secondIds) > 0 && !array_intersect($firstIds, $secondIds), 'News pagination hides or duplicates archived announcements');
$check($first->getParam('total') == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread WHERE node_id = ? AND discussion_state = ?', [$nodes['node:news'], 'visible']), 'Portal pagination includes retired or private content');
$app->request()->set('page', 1);
// Recovery uses the same native author/staff visibility gate as reports.
$recovery = $app->em()->find('XF:Forum', $nodes['node:recovery']);
$check($recovery->allow_index === 'deny' && !$recovery->find_new && $recovery->allowed_watch_notifications === 'none', 'Recovery requests can leak through indexing, feeds or email');
$target = $app->em()->find('XF:User', 1); $target->setOption('admin_edit', true); $target->username = $name; $target->save();
echo "Native account merge, failure rollback, login/TFA preservation, archive attribution/media, repeat import and permanent launch-content retirement passed.\n";
