<?php
namespace Storm\Forum\Pub\Controller;

final class Member extends XFCP_Member
{
    public function actionIndex(\XF\Mvc\ParameterBag $params)
    {
        $users = $this->app()->registry()->get('stormForumHistoricalUsers') ?: [];
        foreach ($users as $identity) {
            if (in_array((int)$params->user_id, $identity['retiredUserIds'] ?? [], true)
                && preg_match('#^members/([^/]+)\.' . (int)$params->user_id . '(?:/|$)#', $this->request->getRoutePath(), $match)
                && in_array($match[1], $identity['slugs'], true)) {
                $user = $this->assertViewableUser($identity['userId']);
                return $this->redirectPermanently($this->buildLink('members', $user));
            }
        }
        $old = $users[$params->user_id] ?? null;
        if ($old && $old['userId'] !== (int)$params->user_id
            && preg_match('#^members/([^/]+)\.' . (int)$params->user_id . '(?:/|$)#', $this->request->getRoutePath(), $match)
            && in_array($match[1], $old['slugs'], true)) {
            $user = $this->assertViewableUser($old['userId']);
            return $this->redirectPermanently($this->buildLink('members', $user));
        }
        return parent::actionIndex($params);
    }
}
