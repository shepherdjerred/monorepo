<?php
// Local CLI provisioning only. Credentials stay in private process pipes.
if (PHP_SAPI !== 'cli') { exit(1); }
use XF\Entity\ApiKey;
use XF\Entity\User;
use XF\Repository\UserRepository;
use XF\Service\ApiKey\ManagerService;
use XF\Service\User\ContentChangeService;
require __DIR__ . '/profile.php';

try {
    $input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $runners = ['codex' => 'Codex', 'claude' => 'Claude', 'cursor' => 'Cursor', 'opencode' => 'OpenCode', 'antigravity' => 'Antigravity', 'grok' => 'Grok'];
    $agent = $input['agent'] ?? '';
    $session = $input['sessionId'] ?? '';
    if (!isset($runners[$agent]) || !is_string($session) || !preg_match('/\A[A-Za-z0-9_.:-]{1,256}\z/', $session)) {
        throw new RuntimeException('Invalid session identity');
    }
    $digest = hash('sha256', $agent . "\0" . $session);
    $name = sessionName($digest);
    $email = $agent . '-' . $digest . '@agents.invalid';
    $marker = 'toolkit-session:' . $digest;
    require '/var/www/html/src/XF.php';
    \XF::start('/var/www/html');
    $app = \XF::setupApp('XF\Cli\App');
    $app->start();
    $admin = $app->em()->find(User::class, 1);
    if (!$admin || $admin->username !== 'Jerred') { throw new RuntimeException('Unexpected trial administrator'); }
    \XF::setVisitor($admin);
    $user = $app->em()->findOne(User::class, ['email' => $email]);
    if ($user && ($user->is_admin || $user->is_moderator || $user->user_state !== 'valid' || !(str_ends_with($user->Profile->about, $marker) || str_ends_with($user->Profile->about, 'Session: ' . $session)))) {
        throw new RuntimeException('Unexpected session account');
    }
    $candidate = $user && preg_match('/\A' . preg_quote($name, '/') . '(?: [2-9]\d*| 1\d+)?\z/', $user->username) ? $user->username : $name;
    for ($suffix = 2; ; $suffix++) {
        $owner = $app->em()->findOne(User::class, ['username' => $candidate]);
        if (!$owner || ($user && $owner->user_id === $user->user_id)) break;
        $candidate = $name . ' ' . $suffix;
    }
    $oldName = $user ? $user->username : null;
    if (!$user) {
        $user = $app->repository(UserRepository::class)->setupBaseUser();
        $user->username = $candidate;
        $user->email = $email;
        $user->user_group_id = 2;
        $user->user_state = 'valid';
        $user->custom_title = $runners[$agent] . ' session';
        $user->Profile->about = sessionAbout($input, $runners[$agent]);
        $user->Auth->setNoPassword();
        $user->save();
    }
    $user->setOption('enqueue_rename_cleanup', false);
    $user->username = $candidate;
    $user->save();
    $user->Profile->about = sessionAbout($input, $runners[$agent]);
    $user->Profile->save();
    if ($oldName !== null && $oldName !== $candidate) {
        $change = $app->service(ContentChangeService::class, $user->user_id, $oldName);
        $change->setupForNameChange($candidate)->apply();
    }
    installSessionAvatar($app, $user, $digest);
    $title = 'toolkit-session-' . substr($digest, 0, 32);
    $key = $app->em()->findOne(ApiKey::class, ['title' => $title]);
    $expected = ['node:read', 'thread:read', 'thread:write', 'search:read', 'search:write'];
    if (!$key) {
        $key = $app->em()->create(ApiKey::class);
        $manager = $app->service(ManagerService::class, $key);
        $manager->setTitle($title);
        $manager->setKeyType('user', $user);
        $manager->setScopes(false, $expected);
        $manager->setActive(true);
        $manager->save();
    }
    $scopes = array_keys($key->scopes);
    sort($scopes);
    sort($expected);
    if ($key->is_super_user || $key->user_id !== $user->user_id || !$key->active || $key->allow_all_scopes || $scopes !== $expected) {
        throw new RuntimeException('Unexpected session key permissions');
    }
    \XF::triggerRunOnce();
    echo json_encode(['username' => $user->username, 'user_id' => $user->user_id, 'api_key' => $key->api_key, 'digest' => $digest], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    fwrite(STDERR, "Session provisioning failed\n");
    exit(1);
}
