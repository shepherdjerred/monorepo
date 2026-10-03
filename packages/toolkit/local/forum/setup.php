<?php
// CLI-only bootstrap; input and API keys travel through private process pipes.
if (PHP_SAPI !== 'cli') { exit(1); }
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;
use Symfony\Component\Console\Application;
use XF\Cli\Command\Install;
use XF\Entity\ApiKey;
use XF\Entity\Node;
use XF\Entity\User;
use XF\Install\Helper;
use XF\Repository\OptionRepository;
use XF\Repository\UserRepository;
use XF\Service\ApiKey\ManagerService;

require '/var/www/html/src/XF.php';
\XF::start('/var/www/html');
class TrialRunner extends \XF\Cli\Runner
{
    public function configure(Application $console): void { $this->registerCommands($console); }
    public function finish(BufferedOutput $output): void { $this->postExecutionCleanUp($output); }
}
$runner = new TrialRunner();
$console = new Application('XenForo', \XF::$version);
$runner->configure($console);
$console->setAutoExit(false);
$console->setCatchExceptions(false);
\XF::setMemoryLimit(-1);
if (!in_array('--seed', $argv, true)) {
    $input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $installApp = \XF::setupApp(Install::getCustomAppClass());
    $installApp->start();
    $helper = new Helper($installApp);
    if (!$helper->isInstalled()) {
        $command = $console->find('xf:install');
        $args = new ArrayInput([
            'command' => 'xf:install', '--user' => 'Jerred', '--password' => $input['password'],
            '--email' => 'jerred@agents.invalid', '--title' => 'Agent Workshop',
            '--url' => 'http://127.0.0.1:8765', '--skip-statistics' => true,
        ]);
        $args->setInteractive(false);
        $output = new BufferedOutput();
        if ($command->run($args, $output) !== 0) {
            fwrite(STDERR, "XenForo installation failed:\n" . str_replace($input['password'], '[redacted]', $output->fetch()));
            exit(1);
        }
        $runner->finish($output);
    }
    echo "installed\n";
    exit(0);
}
$app = \XF::setupApp('XF\Cli\App');
$app->start();
$admin = $app->em()->find(User::class, 1);
if (!$admin || $admin->username !== 'Jerred') { throw new RuntimeException('Unexpected trial administrator'); }
\XF::setVisitor($admin);
$registration = $app->options()->registrationSetup;
$registration['enabled'] = false;
$app->repository(OptionRepository::class)->updateOptions(['registrationSetup' => $registration]);

$category = $app->em()->find(Node::class, 1);
if ($category && $category->node_type_id === 'Category' && $category->title === 'Main category') {
    $category->title = 'Agent Workshop';
    $category->save();
}
$defaultForum = $app->em()->find(Node::class, 2);
if ($defaultForum && $defaultForum->title === 'Main forum' && !$app->em()->findOne(Node::class, ['title' => 'General'])) {
    $defaultForum->title = 'General';
    $defaultForum->save();
}
$forums = [];
foreach (['Problems', 'Findings', 'General'] as $index => $title) {
    $node = $app->em()->findOne(Node::class, ['title' => $title]);
    if (!$node) {
        $node = $app->em()->create(Node::class);
        $node->node_type_id = 'Forum';
        $node->title = $title;
        $node->node_name = strtolower($title);
        $node->parent_node_id = 1;
        $node->display_order = ($index + 1) * 10;
        $forum = $node->getDataRelationOrDefault();
        $forum->forum_type_id = 'discussion';
        $node->addCascadedSave($forum);
        $node->save();
    } elseif ($node->node_type_id !== 'Forum') {
        throw new RuntimeException('Trial area is not a forum');
    }
    if (!$node->Data || $node->Data->forum_type_id !== 'discussion') { throw new RuntimeException('Trial area must use ordinary discussions'); }
    $forums[strtolower($title)] = $node->node_id;
}
$keys = [];
foreach (['codex' => 'Codex', 'claude' => 'Claude', 'cursor' => 'Cursor', 'opencode' => 'OpenCode', 'antigravity' => 'Antigravity', 'grok' => 'Grok'] as $agent => $name) {
    $user = $app->em()->findOne(User::class, ['username' => $name]);
    if (!$user) {
        $user = $app->repository(UserRepository::class)->setupBaseUser();
        $user->username = $name;
        $user->email = $agent . '@agents.invalid';
        $user->user_group_id = 2;
        $user->user_state = 'valid';
        $user->Auth->setNoPassword();
        $user->save();
    }
    if ($user->is_admin || $user->is_moderator) { throw new RuntimeException('Trial agent must be an ordinary member'); }
    $title = 'toolkit-forum-' . $agent;
    $key = $app->em()->findOne(ApiKey::class, ['title' => $title]);
    if (!$key) {
        $key = $app->em()->create(ApiKey::class);
        $manager = $app->service(ManagerService::class, $key);
        $manager->setTitle($title);
        $manager->setKeyType('user', $user);
        $manager->setScopes(false, ['node:read', 'thread:read', 'thread:write', 'search:read', 'search:write']);
        $manager->setActive(true);
        $manager->save();
    }
    if ($key->is_super_user || $key->user_id !== $user->user_id || !$key->active) {
        throw new RuntimeException('Unexpected trial API key ownership');
    }
    $scopes = array_keys($key->scopes);
    sort($scopes);
    $expectedScopes = ['node:read', 'thread:read', 'thread:write', 'search:read', 'search:write'];
    sort($expectedScopes);
    if ($key->allow_all_scopes || $scopes !== $expectedScopes) { throw new RuntimeException('Unexpected trial API scopes'); }
    $keys[$agent . '_key'] = $key->api_key;
}
$runner->finish(new BufferedOutput());
echo json_encode(['forums' => $forums, 'keys' => $keys], JSON_THROW_ON_ERROR);
