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
            $other = $theme['palettes'][$mode === 'light' ? 'dark' : 'light'];
            $native = ['chromeBg','chromeTextColor','subNavBg','subNavTextColor','linkColor','linkHoverColor','majorHeadingBg','majorHeadingTextColor',
                'paletteColor1','paletteColor2','paletteColor3','paletteColor4','paletteColor5','contentBg','contentAltBg','contentHighlightBg',
                'textColor','textColorMuted','textColorDimmed','textColorEmphasized','textColorFeature','borderColor','borderColorLight','borderColorHeavy',
                'inputBgColor','inputTextColor','buttonPrimaryBg','buttonCtaBg','selectedItemBgColor','selectedItemColor','metaThemeColor'];
            foreach ($native as $name) { $values[$name] = ['default'=>$palette[$name], 'alternate'=>$other[$name]]; }
            foreach (['publicLogoUrl','publicLogoUrl2x'] as $name) { $values[$name] = ['default'=>'styles/storm/' . $theme['logos'][$mode], 'alternate'=>'styles/storm/' . $theme['logos'][$mode === 'light' ? 'dark' : 'light']]; }
            $app->repository('XF:StyleProperty')->updatePropertyValues($style, $values);
            $template = $app->finder('XF:Template')->where(['style_id' => $style->style_id, 'type' => 'public', 'title' => 'extra.less'])->fetchOne() ?: $app->em()->create('XF:Template');
            $template->style_id = $style->style_id;
            $template->type = 'public';
            $template->title = 'extra.less';
            $scene = $catalog['scenery'][$theme['scenery']];
            $css = '@stormAccent: @xf-textColorFeature;' . "\n" . file_get_contents('/opt/storm-forum/styles/frame.less');
            $css .= "\n" . 'body { background-image: linear-gradient(fade(#000, 35%), fade(#000, 35%)), url("styles/storm/' . $scene['desktop'] . '"); }';
            $css .= "\n" . '@media (max-width: @xf-responsiveMedium) { body { background-image: linear-gradient(fade(#000, 35%), fade(#000, 35%)), url("styles/storm/' . $scene['mobile'] . '"); } }';
            if ($theme['decoration']) { $css .= "\n" . '.stormGarland { background-image: url("styles/storm/' . $theme['decoration'] . '"); height: 58px; }'; }
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
        if ($mode === 'light') {
            // Additional stable IDs preserve all previous explicit light/dark preferences.
            foreach (array_merge(array_column($catalog['themes'], 'id'), ['auto']) as $id) {
                $system = $this->managedStyle($map, 'system:' . $id);
                $system->bulkSet(['title'=>'The Storm · System · ' . ($id === 'auto' ? 'Follow calendar' : ThemeCatalog::theme($id)['name']),
                    'parent_id'=>$map['light:' . $id], 'user_selectable'=>true, 'enable_variations'=>true]);
                $system->save();
                foreach (['XF:StyleProperty','XF:Template'] as $entity) {
                    foreach ($app->finder($entity)->where('style_id', $system->style_id)->fetch() as $override) { $override->delete(); }
                }
                $map['system:' . $id] = $system->style_id;
            }
        }
        $app->registry()->set('stormForumStyles', $map);
    }

    private function managedStyle(array $map, string $key): \XF\Entity\Style
    {
        $style = isset($map[$key]) ? $this->app->em()->find('XF:Style', $map[$key]) : $this->app->em()->create('XF:Style');
        if (!$style) { throw new \RuntimeException('Managed Storm style missing: ' . $key); }
        return $style;
    }
}
