<?php
namespace Storm\Forum\Pub\Controller;

class Misc extends XFCP_Misc
{
    public function actionStyle()
    {
        $map = $this->app->registry()->get('stormForumStyles') ?: [];
        if ($this->isPost() && ($this->request->exists('storm_mode') || $this->request->exists('storm_theme'))) {
            $mode = $this->filter('storm_mode', 'str');
            $theme = $this->filter('storm_theme', 'str');
            if (!in_array($mode, ['light','dark'], true)) { return $this->error('Choose a valid appearance.'); }
            if ($theme !== 'auto' && !in_array($theme, array_column(\Storm\Forum\Service\ThemeCatalog::load()['themes'], 'id'), true)) {
                return $this->error('Choose a valid theme.');
            }
            $key = $mode . ':' . $theme;
            if (!isset($map[$key])) { throw new \RuntimeException('Managed Storm selection is missing'); }
            $this->request->set('style_id', $map[$key]);
        }
        // Native permission, CSRF, persistence, guest cookies and redirect handling stay authoritative.
        $reply = parent::actionStyle();
        if ($reply instanceof \XF\Mvc\Reply\View && $reply->getTemplateName() === 'style_chooser' && $map) {
            $style = $reply->getParam('style');
            $selectedId = $style ? $style['style_id'] : $this->repository('XF:Style')->getSelectedStyleIdForUser(\XF::visitor());
            $selected = array_search($selectedId, $map, true);
            $mode = 'light'; $theme = 'auto';
            if (is_string($selected) && preg_match('/^(light|dark):([a-z]+)$/D', $selected, $match)) {
                $mode = $match[1]; $theme = $match[2];
            }
            $effective = \Storm\Forum\Service\ThemeCatalog::theme($this->app->registry()->get('stormForumSeason') ?: 'normal');
            $reply->setTemplateName('storm_style_chooser');
            $reply->setParams(['stormMode'=>$mode,'stormTheme'=>$theme,
                'stormThemes'=>\Storm\Forum\Service\ThemeCatalog::load()['themes'],'stormEffectiveTheme'=>$effective['name']]);
        }
        return $reply;
    }
}
