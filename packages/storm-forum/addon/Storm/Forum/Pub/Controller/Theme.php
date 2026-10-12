<?php
namespace Storm\Forum\Pub\Controller;

final class Theme extends \XF\Pub\Controller\AbstractController
{
    protected function json(array $data): \XF\Mvc\Reply\View
    {
        $this->app()->response()->setHeaders(['Cache-Control'=>'no-store', 'Vary'=>'Origin']);
        $reply = $this->view('Storm\Forum:Json', '', ['data'=>$data]);
        $reply->setResponseType('json');
        return $reply;
    }

    protected function cors(): void
    {
        $origin = $this->request->getServer('HTTP_ORIGIN');
        if (!$origin) { return; }
        $host = parse_url($this->options()->boardUrl, PHP_URL_HOST);
        $allowed = ['https://docs.ts-mc.net', rtrim($this->options()->boardUrl, '/')];
        if (in_array($host, ['localhost','127.0.0.1'], true)) {
            $allowed[] = 'http://127.0.0.1:18797';
            $allowed[] = 'http://localhost:18797';
        }
        if (!in_array($origin, $allowed, true)) { throw $this->exception($this->noPermission()); }
        $this->app()->response()->setHeaders(['Access-Control-Allow-Origin'=>$origin, 'Access-Control-Allow-Credentials'=>'true', 'Vary'=>'Origin']);
    }

    public function actionIndex(): \XF\Mvc\Reply\View
    {
        $this->cors();
        $theme = $this->app()->registry()->get('stormForumSeason');
        \Storm\Forum\Service\ThemeCatalog::theme($theme);
        return $this->json(['themeId'=>$theme, 'revision'=>hash_file('sha256', '/opt/storm-theme/catalog.json')]);
    }

    public function actionPreferences(): \XF\Mvc\Reply\AbstractReply
    {
        $this->cors();
        if ($this->isPost()) {
            $this->request->set('storm_preferences_api', '1');
            return $this->rerouteController(\XF\Pub\Controller\MiscController::class, 'Style');
        }
        $service = $this->service('Storm\Forum:Preferences');
        $preferences = $service->current();
        $service->publish($preferences);
        return $this->json(['preferences'=>$preferences, 'csrf'=>$this->app()['csrf.token']]);
    }

    public function actionViewer(): \XF\Mvc\Reply\View
    {
        $this->cors();
        $user = \XF::visitor();
        $links = [];
        foreach (['login','register','account','account/alerts','conversations','logout'] as $route) {
            $links[$route] = $this->buildLink('canonical:' . $route, null, $route === 'logout' ? ['t'=>$this->app()['csrf.token']] : []);
        }
        if (!$this->options()->registrationSetup['enabled']) { $links['register'] = null; }
        return $this->json(['viewer'=>$user->user_id ? [
            'id'=>$user->user_id, 'username'=>$user->username,
            'avatar'=>$user->getAvatarUrl('s', 'custom', true) ?: null,
            'profile'=>$this->buildLink('canonical:members', $user),
            'alerts'=>$user->alerts_unviewed, 'conversations'=>$user->conversations_unread,
        ] : null, 'links'=>$links]);
    }

    public function actionCard(): \XF\Mvc\Reply\AbstractReply
    {
        // Always check as a guest, even if the requester has a signed-in session.
        $guest = $this->app()->repository('XF:User')->getGuestUser();
        $card = \XF::asVisitor($guest, function () {
            $surface = $this->filter('surface', 'str');
            if ($surface === 'docs') {
                $pages = json_decode(file_get_contents('/opt/storm-theme/docs.json'), true, 512, JSON_THROW_ON_ERROR);
                $path = $this->filter('path', 'str');
                if (!isset($pages[$path])) { return null; }
                return ['title'=>$pages[$path], 'section'=>'Player documentation', 'description'=>'Build, explore, and find your way around The Storm.'];
            }
            $threadId = $this->filter('thread', 'uint');
            $forumId = $this->filter('forum', 'uint');
            if ($threadId) {
                $thread = $this->em()->find('XF:Thread', $threadId, ['Forum']);
                if (!$thread || !$thread->canView()) { return null; }
                return ['title'=>$thread->title, 'section'=>$thread->Forum->title, 'description'=>'Join the conversation on The Storm.'];
            }
            if ($forumId) {
                $forum = $this->em()->find('XF:Forum', $forumId);
                if (!$forum || !$forum->canView()) { return null; }
                return ['title'=>$forum->title, 'section'=>'The Storm community', 'description'=>'Read the latest discussions and share your next adventure.'];
            }
            if (!\XF::visitor()->hasPermission('general', 'view')) { return null; }
            return ['title'=>'Welcome to The Storm', 'section'=>'Minecraft Java + Bedrock', 'description'=>'A place to build, explore, and catch up. Server IP: ts-mc.net'];
        });
        if (!$card) { return $this->notFound(); }
        $theme = $this->filter('theme', 'str');
        if ($theme === '') {
            $theme = $this->app()->registry()->get('stormForumSeason');
            \Storm\Forum\Service\ThemeCatalog::theme($theme);
            $params = $this->filter(['surface'=>'str','path'=>'str','thread'=>'uint','forum'=>'uint']);
            $params['theme'] = $theme;
            $this->app()->response()->setHeaders(['Cache-Control'=>'public, max-age=60']);
            return $this->redirect($this->buildLink('canonical:storm-theme/card', null, $params));
        }
        $ids = array_column(\Storm\Forum\Service\ThemeCatalog::load()['themes'], 'id');
        if (!in_array($theme, $ids, true)) { return $this->notFound(); }
        $card['theme'] = $theme;
        $catalog = \Storm\Forum\Service\ThemeCatalog::load();
        $selected = \Storm\Forum\Service\ThemeCatalog::theme($theme);
        $inputs = ['/opt/storm-theme/catalog.json', '/opt/storm-theme/src/render.ts', '/opt/storm-theme/src/render-cli.ts',
            '/opt/storm-theme/assets/' . $selected['contentLogos']['dark'],
            '/opt/storm-theme/assets/' . $catalog['scenery'][$selected['scenery']]['desktop']];
        $revision = '';
        foreach ($inputs as $input) {
            if (!is_file($input)) { throw new \RuntimeException('Card input missing'); }
            $revision .= hash_file('sha256', $input);
        }
        $key = hash('sha256', json_encode($card, JSON_THROW_ON_ERROR) . $revision);
        $directory = '/var/lib/storm-forum/cards';
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) { throw new \RuntimeException('Cannot create card cache'); }
        $path = $directory . '/' . $key . '.png';
        $lock = fopen($directory . '/' . $key . '.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) { throw new \RuntimeException('Cannot lock card cache'); }
        try {
            if (!is_file($path)) {
                $process = proc_open(['bun', '/app/packages/storm-theme/src/render-cli.ts'], [['pipe','r'],['pipe','w'],['pipe','w']], $pipes);
                if (!is_resource($process)) { throw new \RuntimeException('Cannot start card renderer'); }
                fwrite($pipes[0], json_encode($card, JSON_THROW_ON_ERROR)); fclose($pipes[0]);
                $png = stream_get_contents($pipes[1]); fclose($pipes[1]);
                $error = stream_get_contents($pipes[2]); fclose($pipes[2]);
                if (proc_close($process) !== 0 || substr($png, 0, 8) !== "\x89PNG\r\n\x1a\n") { throw new \RuntimeException('Card renderer failed: ' . $error); }
                $temp = tempnam($directory, 'card-');
                if (file_put_contents($temp, $png) === false || !rename($temp, $path)) { throw new \RuntimeException('Cannot persist card'); }
            }
        } finally { flock($lock, LOCK_UN); fclose($lock); }
        $this->app()->response()->contentType('image/png', '');
        $this->app()->response()->setHeaders(['Cache-Control'=>'public, max-age=3600', 'X-Content-Type-Options'=>'nosniff']);
        $reply = $this->view('Storm\Forum:Image', '', ['path'=>$path]);
        $reply->setResponseType('raw');
        return $reply;
    }
}
