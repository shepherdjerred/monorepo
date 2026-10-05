<?php
namespace Storm\Forum\Service;
final class OwnedStyles extends \XF\Service\AbstractService
{
    public function apply(\XF\Entity\Style $parent, string $mode, array &$map): void
    {
        if (!in_array($mode, ['light', 'dark'], true)) { throw new \RuntimeException('Invalid Storm appearance'); }
        $app = $this->app;
        $catalog = ThemeCatalog::load(true);
        foreach ($catalog['themes'] as $theme) {
            $key = $mode . ':' . $theme['id'];
            $style = $this->managedStyle($map, $key);
            $style->title = 'The Storm · ' . ucfirst($mode) . ' · ' . $theme['name'];
            $style->parent_id = $parent->style_id;
            $style->user_selectable = true;
            $style->enable_variations = false;
            $style->save();
            // Remove copied parent values from the foundation so future parent fixes remain inherited.
            foreach ($app->finder('XF:StyleProperty')->where('style_id', $style->style_id)->fetch() as $property) { $property->delete(); }
            $app->service('XF:StyleProperty\Rebuild')->rebuildFullPropertyMap();
            $palette = $theme['palettes'][$mode];
            $values = [];
            foreach (['chromeBg','subNavBg','linkColor','linkHoverColor','majorHeadingBg','majorHeadingTextColor','subNavTextColor'] as $name) { $values[$name] = ['default'=>$palette[$name]]; }
            $values['buttonPrimaryBg'] = ['default'=>$mode === 'light' ? $palette['linkColor'] : $palette['chromeBg']];
            $values['textColorFeature'] = ['default'=>$palette['linkColor']];
            foreach (['publicLogoUrl','publicLogoUrl2x'] as $name) { $values[$name] = ['default'=>'styles/storm/logo.svg']; }
            $app->repository('XF:StyleProperty')->updatePropertyValues($style, $values);
            $template = $app->finder('XF:Template')->where(['style_id' => $style->style_id, 'type' => 'public', 'title' => 'extra.less'])->fetchOne() ?: $app->em()->create('XF:Template');
            $template->style_id = $style->style_id;
            $template->type = 'public';
            $template->title = 'extra.less';
            $scene = $catalog['scenery'][$theme['scenery']];
            $css = '@stormAccent: ' . $palette['accent'] . ";\n" . file_get_contents('/opt/storm-forum/styles/frame.less') . "\n" . file_get_contents('/opt/storm-forum/styles/' . $mode . '.less');
            $css .= "\n" . 'body { background-image: linear-gradient(fade(#122c30, 35%), fade(#122c30, 35%)), url("styles/storm/' . $scene['desktop'] . '"); }';
            $css .= "\n" . '@media (max-width: @xf-responsiveMedium) { body { background-image: linear-gradient(fade(#122c30, 35%), fade(#122c30, 35%)), url("styles/storm/' . $scene['mobile'] . '"); } }';
            if ($theme['decoration']) { $css .= "\n" . '.p-header-content::after { content: ""; background-image: url("styles/storm/' . $theme['decoration'] . '"); }'; }
            $template->template = $css;
            $template->save();
            $map[$key] = $style->style_id;
            $app->registry()->set('stormForumStyles', $map);
        }
        $follower = $this->managedStyle($map, $mode . ':auto');
        $season = $app->registry()->get('stormForumSeason') ?: 'normal';
        ThemeCatalog::theme($season);
        $follower->bulkSet(['title'=>'The Storm · ' . ucfirst($mode) . ' · Follow calendar', 'parent_id'=>$map[$mode . ':' . $season], 'user_selectable'=>true, 'enable_variations'=>false]);
        $follower->save();
        // Followers inherit everything; local snapshots would mask the next seasonal parent.
        foreach (['XF:StyleProperty','XF:Template'] as $entity) {
            foreach ($app->finder($entity)->where('style_id', $follower->style_id)->fetch() as $override) { $override->delete(); }
        }
        $map[$mode . ':auto'] = $follower->style_id;
        $app->registry()->set('stormForumStyles', $map);
    }

    private function managedStyle(array $map, string $key): \XF\Entity\Style
    {
        $style = isset($map[$key]) ? $this->app->em()->find('XF:Style', $map[$key]) : $this->app->em()->create('XF:Style');
        if (!$style) { throw new \RuntimeException('Managed Storm style missing: ' . $key); }
        return $style;
    }
}
