<?php
namespace Storm\Forum\Pub\Controller;

final class Portal extends \XF\Pub\Controller\AbstractController
{
    public function actionIndex(): \XF\Mvc\Reply\View
    {
        $map = $this->app()->registry()->get('stormForumMap');
        if (!is_array($map) || !isset($map['node:news'])) {
            throw new \RuntimeException('The Storm forum configuration has not been applied.');
        }
        $forum = $this->app()->find('XF:Forum', $map['node:news']);
        if (!$forum) { throw new \RuntimeException('Managed news forum is missing.'); }
        $news = new \XF\Mvc\Entity\ArrayCollection([]);
        if ($forum->canView()) {
            $news = $this->app()->finder('XF:Thread')
            ->where('node_id', $map['node:news'])
            ->where('discussion_state', 'visible')
            ->order('post_date', 'DESC')->limit(12)->with(['FirstPost', 'User'])->fetch();
        $news = $news->filter(fn($thread) => $thread->canView());
        }
        // Filter permissions before exposing anything to a public portal.
        // Recent activity uses XF's native widget, which applies visitor permissions.
        $status = null;
        $statusPath = '/var/lib/storm-forum/status.json';
        if (is_file($statusPath)) {
            $status = json_decode(file_get_contents($statusPath), true, 512, JSON_THROW_ON_ERROR);
            if (time() - $status['checkedAt'] > 180) {
                $status = null;
            }
        }
        return $this->view('Storm\Forum:Portal', 'storm_portal', ['news' => $news, 'status' => $status]);
    }
}
