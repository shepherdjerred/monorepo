<?php
// Fixed read-only completion checks for one explicitly acknowledged native step.
// No migration, registry checkpoint, ownership marker or job is changed here.
function stormRecoveryRequire(bool $condition, string $message): void
{
    if (!$condition) { throw new RuntimeException($message . '; inspect and finish the original native command before acknowledging it.'); }
}

function stormRecoveryRead(string $name): array
{
    return json_decode(file_get_contents('/opt/storm-forum/config/' . $name . '.json'), true, 512, JSON_THROW_ON_ERROR);
}

function stormRecoveryKey(array $record, ?int $id = null): string
{
    $era = $record['era'] ?? 'original';
    stormRecoveryRequire(in_array($era, ['original', 'revival2016', 'revival2022'], true), 'Unknown historical era');
    return ($era === 'original' ? '' : $era . ':') . ($id ?? $record['originalId']);
}

function stormRecoveryHash(array $value): string
{
    return hash('sha256', json_encode($value, JSON_THROW_ON_ERROR));
}

function stormRecoveryInstallation($app): void
{
    $manifest = (require '/opt/storm-forum/runtime/manifest.php')();
    $native = $app->db()->fetchRow("SELECT version_id, version_string, is_processing, last_pending_action FROM xf_addon WHERE addon_id = 'XF'");
    stormRecoveryRequire((new XF\Install\Helper($app))->isInstalled()
        && $native && (int)$native['version_id'] === XF::$versionId
        && $native['version_string'] === XF::$version && XF::$version === $manifest['xenforoVersion']
        && !(bool)$native['is_processing'] && empty($native['last_pending_action'])
        && (int)$app->db()->fetchOne('SELECT MAX(completion_date) FROM xf_upgrade_log WHERE version_id = ?', XF::$versionId) > 0,
        'Native XenForo installation/upgrade has not completed at the exact candidate version');
    stormRecoveryRequire((int)$app->db()->fetchOne('SELECT COUNT(*) FROM xf_job WHERE manual_execute = 1') === 0,
        'Native installation/add-on rebuild jobs remain pending (xf:run-jobs --manual-only)');
}

function stormRecoveryAddons($app): void
{
    $expected = json_decode(file_get_contents('/opt/storm-forum/addon/Storm/Forum/addon.json'), true, 512, JSON_THROW_ON_ERROR);
    $native = $app->db()->fetchRow("SELECT version_id, version_string, active, is_processing, last_pending_action FROM xf_addon WHERE addon_id = 'Storm/Forum'");
    $addon = $app->addOnManager()->getById('Storm/Forum');
    stormRecoveryRequire($native && (int)$native['version_id'] === $expected['version_id']
        && $native['version_string'] === $expected['version_string'] && (bool)$native['active']
        && !(bool)$native['is_processing'] && empty($native['last_pending_action'])
        && $addon && !$addon->canInstall() && !$addon->canUpgrade(),
        'Exact candidate Storm/Forum add-on installation is incomplete');
    stormRecoveryRequire((int)$app->db()->fetchOne('SELECT COUNT(*) FROM xf_job WHERE manual_execute = 1') === 0,
        'Native add-on rebuild jobs remain pending (xf:run-jobs --manual-only)');
}

function stormRecoverySeeds($app, callable $read): void
{
    $published = $read('stormForumSeedThreads') ?: [];
    $retired = $read('stormForumRetiredSeeds') ?: [];
    foreach (stormRecoveryRead('seed-content') as $seed) {
        $entry = $retired[$seed['key']] ?? null;
        $id = $published[$seed['key']] ?? null;
        stormRecoveryRequire(is_array($entry) && array_key_exists('threadId', $entry)
            && $entry['threadId'] === $id && is_int($entry['retiredAt'] ?? null) && $entry['retiredAt'] > 0,
            'Generated launch-content retirement checkpoint is incomplete (storm:seed)');
        if ($id === null) { continue; }
        $thread = $app->em()->find('XF:Thread', $id, ['FirstPost']);
        $hashes = [hash('sha256', $seed['message'])];
        if (isset($seed['previousMessageHash'])) { $hashes[] = $seed['previousMessageHash']; }
        stormRecoveryRequire($thread && $thread->discussion_state === 'deleted' && $thread->title === $seed['title']
            && $thread->user_id === $seed['authorId'] && $thread->reply_count === 0 && $thread->FirstPost
            && in_array(hash('sha256', $thread->FirstPost->message), $hashes, true),
            'Generated launch content has not been retired at its exact reviewed identity (storm:seed)');
    }
}

function stormRecoveryNoMerge($app, callable $read): void
{
    stormRecoveryRequire(!$read('stormForumHistoricalMerge')
        && (int)$app->db()->fetchOne("SELECT IS_FREE_LOCK('storm-history-import')") === 1
        && (int)$app->db()->fetchOne("SELECT COUNT(*) FROM xf_job WHERE execute_class = 'XF:UserMerge'") === 0,
        'Historical import/account merge is still active or pending (xf:run-jobs --manual-only)');
}

function stormRecoveryMedia($app, array $entry, array $record, array $assets): void
{
    foreach ($record['posts'] as $post) {
        foreach ($post['attachments'] as $originalId) {
            $asset = $assets[stormRecoveryKey($record, $originalId)] ?? null;
            $nativeId = $entry['attachments'][$post['key']][$originalId] ?? null;
            $native = $nativeId === null ? null : $app->em()->find('XF:Attachment', $nativeId, ['Data']);
            stormRecoveryRequire($asset !== null && $native && $native->Data
                && ($entry['attachmentHashes'][$originalId] ?? null) === stormRecoveryHash($asset)
                && $native->content_type === 'post' && $native->content_id === $entry['posts'][$post['key']]
                && !$native->unassociated, 'Historical media mapping/association is incomplete (storm:history --migrate)');
            $stream = XF::fs()->readStream($native->Data->getAbstractedDataPath());
            stormRecoveryRequire(is_resource($stream), 'Historical media bytes are missing');
            $digest = hash_init('sha256'); $bytes = 0;
            try {
                while (!feof($stream)) {
                    $chunk = fread($stream, 65536);
                    stormRecoveryRequire($chunk !== false, 'Historical media cannot be read');
                    $bytes += strlen($chunk);
                    stormRecoveryRequire($bytes <= $native->Data->file_size, 'Historical media exceeds its native size');
                    hash_update($digest, $chunk);
                }
            } finally { fclose($stream); }
            stormRecoveryRequire($bytes === $native->Data->file_size && hash_final($digest) === $asset['sha256'],
                'Historical media bytes differ from the reviewed corpus (storm:history --migrate)');
        }
    }
}

function stormRecoveryHistory($app, callable $read): void
{
    stormRecoveryNoMerge($app, $read);
    $corpus = stormRecoveryRead('history');
    $map = $read('stormForumHistory') ?: [];
    $users = $read('stormForumHistoricalUsers') ?: [];
    $nodes = $read('stormForumMap') ?: [];
    stormRecoveryRequire(count($map) === count($corpus['threads']) && count($users) === count($corpus['users']),
        'Historical corpus is only partially imported (storm:history --migrate)');
    foreach ($corpus['users'] as $identity) {
        $entry = $users[stormRecoveryKey($identity)] ?? null;
        $native = $entry ? $app->em()->find('XF:User', $entry['userId']) : null;
        $expected = stormRecoveryHash(['identity'=>$identity, 'avatarSha256'=>$identity['avatar'] === null ? null
            : hash_file('sha256', '/opt/storm-forum/assets/history/' . $identity['avatar'])]);
        stormRecoveryRequire($native && ($entry['metadataHash'] ?? null) === $expected
            && $entry['aliases'] === $identity['aliases'] && $entry['slugs'] === $identity['slugs']
            && ($identity['avatar'] === null || !empty($entry['claimed']) || $native->avatar_date > 0),
            'Historical identity/avatar checkpoint is incomplete (storm:history --migrate)');
    }
    $assets = [];
    foreach ($corpus['attachments'] as $asset) { $assets[stormRecoveryKey($asset)] = $asset; }
    $polls = [];
    foreach ($corpus['threads'] as $record) {
        $entry = $map[stormRecoveryKey($record)] ?? null;
        $thread = $entry ? $app->em()->find('XF:Thread', $entry['threadId']) : null;
        stormRecoveryRequire($thread && ($entry['version'] ?? null) === 2 && $entry['hash'] === stormRecoveryHash($record)
            && $entry['slug'] === $record['slug'] && $thread->title === $record['title']
            && $thread->node_id === ($nodes['node:' . $record['node']] ?? null)
            && count($entry['posts']) === count($record['posts']),
            'Historical discussion checkpoint is incomplete (storm:history --migrate)');
        foreach ($record['posts'] as $post) {
            $native = $app->em()->find('XF:Post', $entry['posts'][$post['key']] ?? 0);
            stormRecoveryRequire($native && $native->thread_id === $thread->thread_id && $native->post_date === $post['date']
                && $native->username === $post['author'] && $native->user_id === $users[stormRecoveryKey($record, $post['originalUserId'])]['userId']
                && (hash('sha256', $native->message) === ($entry['messageHashes'][$post['key']] ?? null)
                    || ($entry['conflicts'][$post['key']] ?? null) === 'Staff-edited message retained; recovered formatting available in the corpus'),
                'Historical post identity/content is incomplete (storm:history --migrate)');
        }
        stormRecoveryRequire($thread->first_post_id === $entry['posts'][$record['posts'][0]['key']], 'Historical first-post identity changed');
        $visible = (int)$app->db()->fetchOne("SELECT COUNT(*) FROM xf_post WHERE thread_id = ? AND message_state = 'visible'", $thread->thread_id);
        stormRecoveryRequire($thread->reply_count === max(0, $visible - 1), 'Historical discussion counters are incomplete (storm:history --migrate)');
        stormRecoveryMedia($app, $entry, $record, $assets);
        if (isset($record['poll'])) { $polls[$entry['threadId']] = $record['poll']; }
    }
    stormRecoveryRequire(($read('stormHistoryPolls') ?: []) === $polls && !$read('stormHistoryRatings'),
        'Historical poll/legacy-rating reconciliation is incomplete (storm:history --migrate)');
    foreach (array_unique(array_column($users, 'userId')) as $id) {
        $actual = (int)$app->db()->fetchOne('SELECT message_count FROM xf_user WHERE user_id = ?', $id);
        $expected = (int)$app->db()->fetchOne("SELECT COUNT(*) FROM xf_post p INNER JOIN xf_thread t ON t.thread_id = p.thread_id INNER JOIN xf_forum f ON f.node_id = t.node_id WHERE p.user_id = ? AND p.message_state = 'visible' AND t.discussion_state = 'visible' AND f.count_messages = 1", $id);
        stormRecoveryRequire($actual === $expected, 'Historical user counters are incomplete (storm:history --migrate)');
    }
}

function stormRecoveryAccounts($app, callable $read, string $stage): void
{
    if ($stage === 'beta') { return; } // The reviewed beta command has no account mutation.
    stormRecoveryNoMerge($app, $read);
    $users = $read('stormForumHistoricalUsers') ?: [];
    $entry = $users[1] ?? null;
    $target = $app->em()->find('XF:User', 1);
    stormRecoveryRequire($entry && $entry['aliases'] === ['RiotShielder'] && !empty($entry['claimed'])
        && $entry['userId'] === 1 && $target && $target->is_admin && strtolower($target->username) === 'jerred'
        && $target->email !== '' && $target->user_state === 'valid' && !empty($entry['retiredUserIds']),
        'Reviewed production account merge is incomplete (storm:accounts --stage prod)');
    foreach ($entry['retiredUserIds'] as $id) {
        stormRecoveryRequire($id !== 1 && !$app->em()->find('XF:User', $id), 'Retired native merge donor still exists');
    }
    $map = $read('stormForumHistory') ?: [];
    foreach (stormRecoveryRead('history')['threads'] as $record) {
        foreach ($record['posts'] as $post) {
            if (($users[stormRecoveryKey($record, $post['originalUserId'])]['userId'] ?? null) !== 1) { continue; }
            $native = $app->em()->find('XF:Post', $map[stormRecoveryKey($record)]['posts'][$post['key']] ?? 0);
            stormRecoveryRequire($native && $native->user_id === 1 && $native->username === $post['author'] && $native->post_date === $post['date'],
                'Claimed historical posts lost their native owner or archive attribution');
        }
    }
}

function stormVerifyRecoveryStep($app, string $step, string $stage): void
{
    stormRecoveryRequire(in_array($stage, ['beta', 'prod'], true), 'An exact Forum stage is required');
    $read = static fn(string $key) => (new XF\DataRegistry($app->db()))->get($key);
    switch ($step) {
        case 'install': stormRecoveryInstallation($app); break;
        case 'addons': stormRecoveryAddons($app); break;
        case 'seed': stormRecoverySeeds($app, $read); break;
        case 'history': stormRecoveryHistory($app, $read); break;
        case 'accounts': stormRecoveryAccounts($app, $read, $stage); break;
        default: throw new RuntimeException('Only the exact ambiguous native Forum step may be verified');
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    require '/app/forum/src/XF.php'; XF::start('/app/forum');
    $app = XF::setupApp('XF\Cli\App');
    $db = $app->db(); $db->query('SET TRANSACTION READ ONLY'); $db->beginTransaction();
    try { $app->start(); stormVerifyRecoveryStep($app, $argv[1] ?? '', getenv('STORM_FORUM_STAGE') ?: ''); }
    finally { $db->rollback(); }
    echo "verified\n";
}
