<?php
// The operator wrapper supplies $payload through stdin; no remote image fetches.
require '/app/forum/src/XF.php';
\XF::start('/app/forum');
$app = \XF::setupApp('XF\Cli\App');
$app->start();
$db = $app->db();
if (!$db->fetchOne('SELECT GET_LOCK(?, 0)', 'storm-history-import')) {
    throw new \RuntimeException('Another historical operation is running');
}
try {
    $registry = new \XF\DataRegistry($db);
    if ($registry->get('stormForumHistoricalMerge')) {
        throw new \RuntimeException('Historical account merge is pending');
    }
    $users = $registry->get('stormForumHistoricalUsers');
    $fingerprint = hash('sha256', serialize($users));
    $seen = [];
    foreach ($payload['avatars'] as $item) {
        $mapping = $users[$item['originalId']] ?? null;
        if (!$mapping || $mapping['userId'] !== $item['expectedUserId']
            || !in_array($item['historicalName'], $mapping['aliases'], true)
            || isset($seen[$mapping['userId']])) {
            throw new \RuntimeException('Historical identity mapping mismatch');
        }
        $seen[$mapping['userId']] = true;
        $bytes = base64_decode($item['image'], true);
        $info = $bytes === false ? false : @getimagesizefromstring($bytes);
        if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)
            || hash('sha256', $bytes) !== $item['sha256']) {
            throw new \RuntimeException('Avatar image integrity mismatch');
        }
        if (!$app->em()->find('XF:User', $mapping['userId'])) {
            throw new \RuntimeException('Historical profile missing');
        }
    }
    $results = [];
    foreach ($payload['avatars'] as $item) {
        $db->beginTransaction();
        $temp = null;
        try {
            // Serialize with member avatar updates and re-read after taking the lock.
            $row = $db->fetchRow('SELECT user_id,avatar_date,gravatar FROM xf_user WHERE user_id=? FOR UPDATE', $item['expectedUserId']);
            if (!$row) { throw new \RuntimeException('Historical profile missing'); }
            $app->em()->clearEntityCache();
            $user = $app->em()->find('XF:User', $item['expectedUserId']);
            $status = $row['avatar_date'] || $row['gravatar'] ? 'preserved' : 'missing';
            if ($status === 'missing' && $payload['apply']) {
                $temp = tempnam(sys_get_temp_dir(), 'storm-avatar-');
                if (!$temp || file_put_contents($temp, base64_decode($item['image'], true)) === false) {
                    throw new \RuntimeException('Cannot stage avatar');
                }
                $avatar = $app->service('XF:User\Avatar', $user);
                $avatar->logIp(false); $avatar->logChange(false); $avatar->silentRunning(true);
                if (!$avatar->setImage($temp) || !$avatar->updateAvatar()) {
                    throw new \RuntimeException('Native avatar restoration failed');
                }
                $status = 'restored';
            }
            $results[] = ['originalId'=>$item['originalId'], 'userId'=>$user->user_id,
                'username'=>$user->username, 'status'=>$status,
                'url'=>$user->avatar_date ? $user->getAvatarUrl('m', 'custom', true) : null];
            $db->commit();
        } catch (\Throwable $error) {
            $db->rollback(); throw $error;
        } finally {
            if ($temp !== null && is_file($temp)) { unlink($temp); }
        }
    }
    if (hash('sha256', serialize((new \XF\DataRegistry($db))->get('stormForumHistoricalUsers'))) !== $fingerprint) {
        throw new \RuntimeException('Historical registry changed during recovery');
    }
    echo json_encode(['apply'=>$payload['apply'], 'historicalRegistryPreserved'=>true, 'avatars'=>$results], JSON_THROW_ON_ERROR) . "\n";
} finally {
    $db->fetchOne('SELECT RELEASE_LOCK(?)', 'storm-history-import');
}
