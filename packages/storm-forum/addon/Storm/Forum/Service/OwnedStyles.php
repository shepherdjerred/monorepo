<?php
namespace Storm\Forum\Service;
final class OwnedStyles extends \XF\Service\AbstractService
{
    public function apply(\XF\Entity\Style $parent, string $mode, array &$map, string $variation = 'default'): void
    {
        if (!in_array($mode, ['light', 'dark'], true)) { throw new \RuntimeException('Invalid Storm appearance'); }
        $app = $this->app;
        $values = [];
        foreach ($app->repository('XF:StyleProperty')->findPropertyMapInStyle($parent)->fetch() as $mapping) {
            $property = $mapping->Property;
            if ($property->has_variations) {
                $values[$property->property_name] = ['default' => $property->getVariationValue($variation)];
            }
        }
        foreach (['publicLogoUrl', 'publicLogoUrl2x'] as $key) { $values[$key] = ['default' => 'styles/storm/logo.svg']; }
        foreach (['normal', 'halloween', 'christmas'] as $season) {
            $key = $mode . ':' . $season;
            $style = isset($map[$key]) ? $app->em()->find('XF:Style', $map[$key]) : $app->em()->create('XF:Style');
            if (!$style) { throw new \RuntimeException('Managed Storm style missing'); }
            $style->title = 'The Storm · ' . ucfirst($mode) . ($season === 'normal' ? '' : ' · ' . ucfirst($season));
            $style->parent_id = $parent->style_id;
            $style->user_selectable = true;
            $style->enable_variations = false;
            $style->save();
            $app->repository('XF:StyleProperty')->updatePropertyValues($style, $values);
            $template = $app->finder('XF:Template')->where(['style_id' => $style->style_id, 'type' => 'public', 'title' => 'extra.less'])->fetchOne() ?: $app->em()->create('XF:Template');
            $template->style_id = $style->style_id;
            $template->type = 'public';
            $template->title = 'extra.less';
            $template->template = file_get_contents('/opt/storm-forum/styles/frame.less') . "\n" . file_get_contents('/opt/storm-forum/styles/' . $mode . '.less') . "\n" . file_get_contents('/opt/storm-forum/styles/' . $season . '.less');
            $template->save();
            $map[$key] = $style->style_id;
            $app->registry()->set('stormForumStyles', $map);
        }
    }
}
