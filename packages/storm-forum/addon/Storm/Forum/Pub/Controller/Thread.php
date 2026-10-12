<?php
namespace Storm\Forum\Pub\Controller;

final class Thread extends XFCP_Thread
{
    public function actionIndex(\XF\Mvc\ParameterBag $params)
    {
        $map = $this->app()->registry()->get('stormForumHistory') ?: [];
        $old = $map[$params->thread_id] ?? null;
        // Match the archived slug too: an unrelated native ID must retain its own route.
        if ($old && $old['threadId'] !== (int)$params->thread_id && preg_match('#^threads/([^/]+)\.' . (int)$params->thread_id . '(?:/|$)#', $this->request->getRoutePath(), $match)
            && $match[1] === $old['slug']) {
            $thread = $this->assertViewableThread($old['threadId']);
            return $this->redirectPermanently($this->buildLink('threads', $thread, ['page'=>$params->page]));
        }
        return parent::actionIndex($params);
    }
}
