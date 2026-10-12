<?php
namespace Storm\Forum\Service;

final class Preferences extends \XF\Service\AbstractService
{
    public function current(): array
    {
        $visitor = \XF::visitor();
        $id = $this->app->repository('XF:Style')->getSelectedStyleIdForUser($visitor);
        $map = $this->app->registry()->get('stormForumStyles') ?: [];
        $key = array_search($id, $map, true);
        if ($key === false) {
            // Existing native/third-party selections remain untouched until the visitor saves a managed choice.
            $style = $this->app->style($id);
            $appearance = $style['enable_variations'] && $visitor->style_variation === '' ? 'system'
                : $style->getPropertyVariation('styleType', $visitor->style_variation ?: 'default');
            if (!in_array($appearance, ['system','light','dark'], true)) { throw new \RuntimeException('Invalid native style appearance'); }
            $match = ['', $appearance, 'auto'];
        } elseif (!is_string($key) || !preg_match('/^(system|light|dark):([a-z]+)$/D', $key, $match)) {
            throw new \RuntimeException('Invalid managed Storm presentation');
        }
        $appearance = $match[1];
        if ($key !== false && $appearance === 'system' && $visitor->style_variation !== '') {
            $appearance = $this->app->style($id)->getPropertyVariation('styleType', $visitor->style_variation);
        }
        $effects = true;
        $cookie = $_COOKIE['storm_preferences'] ?? null;
        if (is_string($cookie)) {
            try {
                $decoded = json_decode($cookie, true, 512, JSON_THROW_ON_ERROR);
                if (($decoded['version'] ?? null) === 1 && is_bool($decoded['effects'] ?? null)) { $effects = $decoded['effects']; }
            } catch (\JsonException $error) { /* Invalid visitor cookie; native appearance remains authoritative. */ }
        }
        return ['version'=>1, 'appearance'=>$appearance, 'theme'=>$match[2], 'effects'=>$effects];
    }

    public function publish(array $preferences): void
    {
        if (!in_array($preferences['appearance'], ['system','light','dark'], true) || !is_bool($preferences['effects'])) {
            throw new \RuntimeException('Invalid Storm preferences');
        }
        if ($preferences['theme'] !== 'auto') { ThemeCatalog::theme($preferences['theme']); }
        $host = parse_url($this->app->options()->boardUrl, PHP_URL_HOST);
        $domain = $host === 'ts-mc.net' ? 'ts-mc.net' : '';
        $secure = parse_url($this->app->options()->boardUrl, PHP_URL_SCHEME) === 'https';
        $this->app->response()->setCookieRaw('storm_preferences', json_encode($preferences, JSON_THROW_ON_ERROR), 31536000, '/', $domain, $secure, false, 'Lax');
    }
}
