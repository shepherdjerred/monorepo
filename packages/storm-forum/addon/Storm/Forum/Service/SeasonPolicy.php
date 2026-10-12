<?php
namespace Storm\Forum\Service;

final class SeasonPolicy extends \XF\Service\AbstractService
{
    public function apply(string $season, bool $follow): bool
    {
        ThemeCatalog::load(true);
        ThemeCatalog::theme($season);
        $map = $this->app->registry()->get('stormForumStyles') ?: [];
        $targets = [];
        foreach (['light','dark','system'] as $mode) {
            foreach ([$season, 'auto'] as $id) {
                $key = $mode . ':' . $id;
                $style = isset($map[$key]) ? $this->app->em()->find('XF:Style', $map[$key]) : null;
                if (!$style || !$style->user_selectable) { throw new \RuntimeException('Configured seasonal style is missing: ' . $key); }
                $targets[$key] = $style;
            }
        }
        $changed = false;
        foreach (['light','dark','system'] as $mode) {
            $follower = $targets[$mode . ':auto'];
            $parentId = $targets[$mode . ':' . $season]->style_id;
            if ($follower->parent_id !== $parentId) {
                $follower->parent_id = $parentId;
                $follower->save();
                $changed = true;
            }
        }
        $defaultId = $targets['system:' . ($follow ? 'auto' : $season)]->style_id;
        if ($this->app->options()->defaultStyleId != $defaultId) {
            $this->app->repository('XF:Option')->updateOption('defaultStyleId', $defaultId);
            $this->app->options()->defaultStyleId = $defaultId;
        }
        foreach (['stormForumSeason'=>$season,'stormForumFollowCalendar'=>$follow] as $key=>$value) {
            if ($this->app->registry()->get($key) !== $value) { $this->app->registry()->set($key, $value); }
        }
        if ($changed) {
            $this->app->service('XF:StyleProperty\Rebuild')->rebuildFullPropertyMap();
            $this->app->repository('XF:Style')->triggerStyleDataRebuild();
        }
        return $changed;
    }
}
