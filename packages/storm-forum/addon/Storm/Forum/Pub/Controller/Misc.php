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
            if (!in_array($mode, ['system','light','dark'], true)) { return $this->error('Choose a valid appearance.'); }
            if ($theme !== 'auto' && !in_array($theme, array_column(\Storm\Forum\Service\ThemeCatalog::load()['themes'], 'id'), true)) {
                return $this->error('Choose a valid theme.');
            }
            $key = $mode . ':' . $theme;
            if (!isset($map[$key])) { throw new \RuntimeException('Managed Storm selection is missing'); }
            $this->assertValidCsrfToken($this->filter('t', 'str'));
            if (!\XF::visitor()->canChangeStyle($error)) { return $this->noPermission($error); }
            if (\XF::visitor()->user_id) { \XF::visitor()->style_variation = ''; }
            $this->request->set('style_id', $map[$key]);
        }
        // Native permission, CSRF, persistence, guest cookies and redirect handling stay authoritative.
        $reply = parent::actionStyle();
        if ($this->isPost() && $reply instanceof \XF\Mvc\Reply\Redirect && $this->request->exists('storm_mode')) {
            if (!\XF::visitor()->user_id) { $this->app->response()->setCookie('style_variation', false); }
            $service = $this->service('Storm\Forum:Preferences');
            $preferences = ['version'=>1, 'appearance'=>$this->filter('storm_mode', 'str'),
                'theme'=>$this->filter('storm_theme', 'str'), 'effects'=>$this->filter('storm_effects', 'bool')];
            $service->publish($preferences);
            if ($this->filter('storm_preferences_api', 'bool')) {
                $this->app->response()->setHeaders(['Cache-Control'=>'no-store']);
                $reply = $this->view('Storm\Forum:Json', '', ['data'=>['preferences'=>$preferences, 'csrf'=>$this->app['csrf.token']]]);
                $reply->setResponseType('json');
            }
        }
        if ($reply instanceof \XF\Mvc\Reply\View && $reply->getTemplateName() === 'style_chooser' && $map) {
            $style = $reply->getParam('style');
            $selectedId = $style ? $style['style_id'] : $this->repository('XF:Style')->getSelectedStyleIdForUser(\XF::visitor());
            $selected = array_search($selectedId, $map, true);
            $mode = 'system'; $theme = 'auto';
            if (is_string($selected) && preg_match('/^(system|light|dark):([a-z]+)$/D', $selected, $match)) {
                $mode = $match[1]; $theme = $match[2];
            }
            $effective = \Storm\Forum\Service\ThemeCatalog::theme($this->app->registry()->get('stormForumSeason') ?: 'normal');
            $reply->setTemplateName('storm_style_chooser');
            $reply->setParams(['stormMode'=>$mode,'stormTheme'=>$theme,
                'stormThemes'=>\Storm\Forum\Service\ThemeCatalog::load()['themes'],'stormEffectiveTheme'=>$effective['name'],
                'stormEffects'=>$this->service('Storm\Forum:Preferences')->current()['effects']]);
        }
        return $reply;
    }
}
