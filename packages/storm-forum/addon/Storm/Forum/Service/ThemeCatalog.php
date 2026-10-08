<?php
namespace Storm\Forum\Service;

final class ThemeCatalog
{
    public static function load(bool $validateAssets = false): array
    {
        $catalog = json_decode(file_get_contents('/opt/storm-theme/catalog.json'), true, 512, JSON_THROW_ON_ERROR);
        if ($catalog['version'] !== 4 || $catalog['timeZone'] !== 'America/Los_Angeles' || !$catalog['themes']) {
            throw new \RuntimeException('Invalid Storm theme catalog');
        }
        $ids = [];
        $asset = static function (string $path) use ($validateAssets): void {
            if (!preg_match('/^[a-z\/-]+\.(jpg|svg)$/D', $path) || str_contains($path, '..')
                || ($validateAssets && !is_file('/opt/storm-theme/assets/' . $path))) {
                throw new \RuntimeException('Invalid or missing Storm theme asset: ' . $path);
            }
        };
        foreach ($catalog['scenery'] as $scene) {
            $asset($scene['desktop']);
            $asset($scene['mobile']);
        }
        $windows = [];
        foreach ($catalog['themes'] as $theme) {
            if (!preg_match('/^[a-z]+$/D', $theme['id']) || $theme['id'] === 'auto' || isset($ids[$theme['id']])
                || !is_string($theme['name']) || $theme['name'] === '' || !isset($catalog['scenery'][$theme['scenery']])) {
                throw new \RuntimeException('Invalid or duplicate Storm theme');
            }
            $ids[$theme['id']] = true;
            if ($theme['decoration'] !== null) { $asset($theme['decoration']); }
            foreach (['light', 'dark'] as $mode) {
                $palette = $theme['palettes'][$mode];
                $keys = ['chromeBg','subNavBg','accent','linkColor','linkHoverColor','majorHeadingBg','majorHeadingTextColor','subNavTextColor',
                    'chromeTextColor','chromeHoverColor','subNavHoverColor','contentBg','contentAltBg','contentHighlightBg','textColor','pageBg','minorHeadingTextColor',
                    'textColorMuted','textColorDimmed','textColorEmphasized','textColorFeature','borderColor','borderColorLight','borderColorHeavy',
                    'inputBgColor','inputTextColor','inputBorderColor','controlColor','focusColor','buttonPrimaryBg','buttonPrimaryColor',
                    'buttonPrimaryHoverBg','buttonCtaBg','buttonCtaColor','selectedItemBgColor','selectedItemColor',
                    'paletteColor1','paletteColor2','paletteColor3','paletteColor4','paletteColor5','logoColor','metaThemeColor'];
                if (array_diff($keys, array_keys($palette)) || array_diff(array_keys($palette), $keys)) {
                    throw new \RuntimeException('Incomplete Storm theme palette');
                }
                foreach ($palette as $color) {
                    if (!is_string($color) || !preg_match('/^#[a-f0-9]{6}$/iD', $color)) { throw new \RuntimeException('Invalid Storm theme color'); }
                }
                $asset($theme['logos'][$mode]);
                $asset($theme['contentLogos'][$mode]);
            }
            if (!in_array($theme['effect'], [null,'confetti','hearts','petals','sparks','leaves','ghosts','snow'], true)
                || ($theme['effect'] !== null && $theme['window'] === null)) { throw new \RuntimeException('Invalid Storm holiday effect'); }
            if ($theme['window'] !== null) {
                [$start, $end] = $theme['window'];
                if (!is_int($start) || !is_int($end) || $start > $end
                    || !checkdate(intdiv($start, 100), $start % 100, 2024)
                    || !checkdate(intdiv($end, 100), $end % 100, 2024)) {
                    throw new \RuntimeException('Invalid Storm festival window');
                }
                for ($day = $start; $day <= $end; $day++) {
                    if (isset($windows[$day])) { throw new \RuntimeException('Overlapping Storm festival windows'); }
                    $windows[$day] = true;
                }
            }
        }
        if (array_diff(['normal','spring','summer','autumn','winter'], array_keys($ids))) {
            throw new \RuntimeException('Missing Storm base season');
        }
        return $catalog;
    }

    public static function theme(string $id): array
    {
        foreach (self::load()['themes'] as $theme) { if ($theme['id'] === $id) { return $theme; } }
        throw new \RuntimeException('Unknown Storm theme: ' . $id);
    }
}
