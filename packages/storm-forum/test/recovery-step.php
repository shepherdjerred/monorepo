<?php
// Only the disposable licensed integration installation may execute this fixture.
require '/app/forum/src/XF.php'; XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
require '/opt/storm-forum/runtime/recovery-step-verify.php';
$check = static function (bool $ok, string $message): void { if (!$ok) { throw new RuntimeException($message); } };
$verify = static function (string $step, string $stage = 'prod') use ($app): void {
    $db = $app->db(); $db->query('SET TRANSACTION READ ONLY'); $db->beginTransaction();
    try { stormVerifyRecoveryStep($app, $step, $stage); }
    finally { $db->rollback(); }
};
$refuses = static function (string $step, string $message) use ($verify, $check): void {
    $rejected = false;
    try { $verify($step); }
    catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), $message); }
    $check($rejected, 'Read-only verifier acknowledged incomplete ' . $step);
};
foreach (['install', 'addons', 'seed', 'history'] as $step) { $verify($step); }
$verify('accounts', 'beta');
$refuses('configure', 'Only the exact ambiguous');

$db = $app->db();
$native = $db->fetchRow("SELECT is_processing, last_pending_action FROM xf_addon WHERE addon_id = 'Storm/Forum'");
try {
    $db->query("UPDATE xf_addon SET is_processing = 1 WHERE addon_id = 'Storm/Forum'");
    $refuses('addons', 'installation is incomplete');
} finally { $db->update('xf_addon', $native, "addon_id = 'Storm/Forum'"); }
$logs = $db->fetchAll('SELECT version_id, log_type, completion_date FROM xf_upgrade_log WHERE version_id = ?', XF::$versionId);
try {
    $db->query('UPDATE xf_upgrade_log SET completion_date = 0 WHERE version_id = ?', XF::$versionId);
    $refuses('install', 'installation/upgrade has not completed');
} finally {
    foreach ($logs as $log) { $db->update('xf_upgrade_log', ['completion_date'=>$log['completion_date']], 'version_id = ? AND log_type = ?', [$log['version_id'], $log['log_type']]); }
}

$mutateRegistry = static function (string $key, callable $change, string $step, string $message) use ($app, $refuses): void {
    $original = (new XF\DataRegistry($app->db()))->get($key);
    try { $app->registry()->set($key, $change($original)); $refuses($step, $message); }
    finally {
        if ($original === null) { $app->registry()->delete($key); }
        else { $app->registry()->set($key, $original); }
        $app->em()->clearEntityCache();
    }
};
$mutateRegistry('stormForumRetiredSeeds', static function ($value) { unset($value[array_key_first($value)]); return $value; }, 'seed', 'retirement checkpoint is incomplete');
$mutateRegistry('stormForumHistory', static function ($value) { $value[array_key_first($value)]['version'] = 0; return $value; }, 'history', 'discussion checkpoint is incomplete');
$mutateRegistry('stormForumHistory', static function ($value) { $key = array_key_first($value); unset($value[$key]['posts'][array_key_first($value[$key]['posts'])]); return $value; }, 'history', 'discussion checkpoint is incomplete');
$mutateRegistry('stormForumHistoricalMerge', static fn($value) => ['source'=>123, 'target'=>1], 'history', 'merge is still active');
$mutateRegistry('stormHistoryPolls', static fn($value) => [], 'history', 'poll/legacy-rating reconciliation is incomplete');
$users = $app->registry()->get('stormForumHistoricalUsers'); $userId = reset($users)['userId'];
$count = $db->fetchOne('SELECT message_count FROM xf_user WHERE user_id = ?', $userId);
try {
    $db->query('UPDATE xf_user SET message_count = message_count + 1 WHERE user_id = ?', $userId);
    $refuses('history', 'user counters are incomplete');
} finally { $db->query('UPDATE xf_user SET message_count = ? WHERE user_id = ?', [$count, $userId]); }
$map = $app->registry()->get('stormForumHistory'); $attachmentId = null;
foreach ($map as $entry) {
    foreach ($entry['attachments'] ?? [] as $attachments) {
        if ($attachments) { $attachmentId = reset($attachments); break 2; }
    }
}
$check($attachmentId !== null, 'Native recovery fixture has no imported media');
$contentId = $db->fetchOne('SELECT content_id FROM xf_attachment WHERE attachment_id = ?', $attachmentId);
try {
    $db->query('UPDATE xf_attachment SET content_id = content_id + 1 WHERE attachment_id = ?', $attachmentId);
    $app->em()->clearEntityCache(); $refuses('history', 'media mapping/association is incomplete');
} finally {
    $db->query('UPDATE xf_attachment SET content_id = ? WHERE attachment_id = ?', [$contentId, $attachmentId]);
    $app->em()->clearEntityCache();
}

$target = $app->em()->find('XF:User', 1); $name = $target->username;
try {
    $target->setOption('admin_edit', true); $target->username = 'jerred'; $target->save();
    $verify('accounts');
    $mutateRegistry('stormForumHistoricalUsers', static function ($value) { $value[1]['claimed'] = false; return $value; }, 'accounts', 'account merge is incomplete');
    $mutateRegistry('stormForumHistoricalMerge', static fn($value) => ['source'=>123, 'target'=>1], 'accounts', 'merge is still active');
} finally {
    $target = $app->em()->find('XF:User', 1); $target->setOption('admin_edit', true); $target->username = $name; $target->save();
}
foreach (['install', 'addons', 'seed', 'history'] as $step) { $verify($step); }
echo "Read-only recovery verifies all five native steps and rejects incomplete installation/add-on/retirement/history/media/account state without replay.\n";
