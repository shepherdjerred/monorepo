<?php
// Build a native style archive from version-controlled theme customizations and local licensed XF2.
$root = $argv[1] ?? '/app/forum';
$destination = $argv[2] ?? throw new InvalidArgumentException('An explicit private export directory is required');
if (!is_dir($destination)) { throw new RuntimeException('Theme output directory must exist'); }
require_once $root . '/src/XF.php';
XF::start($root);
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::app();
$app->start();
if (!in_array(parse_url($app->options()->boardUrl, PHP_URL_HOST), ['localhost', '127.0.0.1'], true)) {
    throw new RuntimeException('Theme builds require a disposable localhost installation');
}
$core = $app->em()->find('XF:Style', 1);
if (!$core) { throw new RuntimeException('Disposable installation is missing its core style'); }
$updateTemplate = static function ($style, string $title, string $text, string $addon = '') use ($app): void {
    $template = $app->finder('XF:Template')->where(['style_id'=>$style->style_id,'type'=>'public','title'=>$title])->fetchOne() ?: $app->em()->create('XF:Template');
    // Native new unowned templates use version 0; retain that on repeat builds as well.
    $template->bulkSet(['style_id'=>$style->style_id,'type'=>'public','title'=>$title,'template'=>$text,'addon_id'=>$addon,'version_id'=>$addon === 'XF' ? XF::$versionId : 0,'version_string'=>$addon === 'XF' ? XF::$version : '']);
    $template->save();
};
foreach (['light', 'dark'] as $mode) {
    $dark = $mode === 'dark';
    $title = 'Flexile · The Storm · ' . ucfirst($mode);
    $style = $app->finder('XF:Style')->where('title', $title)->fetchOne() ?: $app->em()->create('XF:Style');
    $style->bulkSet(['title'=>$title,'description'=>'Private Flexile adaptation for The Storm, version 2.0.0.','parent_id'=>1,'user_selectable'=>false,'enable_variations'=>false]);
    $style->save();
    $group = $app->finder('XF:StylePropertyGroup')->where(['style_id'=>$style->style_id,'group_name'=>'flexile'])->fetchOne() ?: $app->em()->create('XF:StylePropertyGroup');
    $group->bulkSet(['style_id'=>$style->style_id,'group_name'=>'flexile','title'=>'Flexile','display_order'=>1,'addon_id'=>'']);
    $group->save();
    $custom = [
        'flexile_show_header_content'=>['Show header content','boolean',1],
        'flexile_header_content'=>['Header content (HTML)','string','<p>A place to build, explore, and catch up.<br /><strong>Join: ts-mc.net</strong></p>'],
        'flexile_primaryBorderColor'=>['Primary border color','color','@xf-borderColor'],
        'flexile_header_content_style'=>['Header content box','css',['background-color'=>'fade(#000, 13%)','border-top-width'=>'1px','border-top-color'=>'fade(#fff, 20%)','border-radius'=>'6px','padding'=>'12px']],
    ];
    foreach ($custom as $name=>[$label,$type,$value]) {
        $property = $app->finder('XF:StyleProperty')->where(['style_id'=>$style->style_id,'property_name'=>$name])->fetchOne() ?: $app->em()->create('XF:StyleProperty');
        $property->bulkSet(['style_id'=>$style->style_id,'property_name'=>$name,'group_name'=>'flexile','title'=>$label,'property_type'=>$type === 'css' ? 'css' : 'value',
            'value_type'=>$type === 'css' ? '' : $type,'css_components'=>$type === 'css' ? ['text','background','border','border_radius','padding','extra'] : [],
            'property_value'=>$value,'has_variations'=>false,'addon_id'=>'']);
        $property->save();
    }
    // Native property writes require the inherited map, rebuilt asynchronously by normal ACP requests.
    $app->service('XF:StyleProperty\Rebuild')->rebuildFullPropertyMap();
    $properties = [];
    foreach ($app->repository('XF:StyleProperty')->findPropertyMapInStyle($core)->fetch() as $mapping) {
        $p = $mapping->Property;
        if ($p->has_variations) { $properties[$p->property_name] = ['default'=>$p->getVariationValue($dark ? 'alternate' : 'default')]; }
    }
    $plain = [
        'fontFamilyBody' => "'Trebuchet MS', Helvetica, Arial, sans-serif",
        'fontFamilyUi' => "'Trebuchet MS', Helvetica, Arial, sans-serif",
        'fontSizeNormal' => '13px',
        'fontSizeSmall' => '12px',
        'fontSizeSmaller' => '11px',
        'fontSizeLarge' => '15px',
        'fontSizeLarger' => '18px',
        'fontSizeLargest' => '24px',
        'pageWidthMax' => '1170px',
        'sidebarWidth' => '250px',
        'sidebarSpacer' => '12px',
        'publicLogoWidth' => '180',
        'publicLogoHeight' => '64',
        'publicNavPaddingH' => '15px',
        'publicNavPaddingV' => '8px',
        'publicSubNavPaddingV' => '8px',
        'publicNavSticky' => 'primary',
        'blockBorderRadius' => '6px',
        'avatarBorderRadius' => '5px',
    ];
    $colors = [
        'paletteColor1' => $dark?'#c5efe6':'#f0fcf9',
        'paletteColor2' => $dark?'#83cabb':'#a5e4d4',
        'paletteColor3' => $dark?'#4cb9a5':'#38d1a5',
        'paletteColor4' => $dark?'#18594e':'#087361',
        'paletteColor5' => $dark?'#0b332c':'#1a6357',
        'chromeBg' => $dark?'#124f43':'#11a78e',
        'chromeTextColor' => '#ffffff',
        'subNavBg' => $dark?'#217963':'#38d1a5',
        'subNavTextColor' => $dark?'#ffffff':'#073f34',
        'linkColor' => $dark?'#83d9c3':'#087361',
        'linkHoverColor' => $dark?'#b7f0df':'#034635',
        'textColorFeature' => $dark?'#72cbb7':'#087361',
        'textColorEmphasized' => $dark?'#ebebeb':'#242424',
        'contentBg' => $dark?'#2a2a2a':'#ffffff',
        'contentAltBg' => $dark?'#222222':'#f1f1ec',
        'contentHighlightBg' => $dark?'#263831':'#f0fcf9',
        'pageBg' => $dark?'#1e1e1e':'#efefef',
        'textColor' => $dark?'#ebebeb':'#333333',
        'textColorMuted' => $dark?'#aaa':'#777',
        'textColorDimmed' => $dark?'#bcbcbc':'#666',
        'borderColor' => $dark?'#454545':'#d5d5d5',
        'borderColorLight' => $dark?'#393939':'#e5e5e5',
        'borderColorHeavy' => $dark?'#555555':'#c5c5c5',
        'inputBgColor' => $dark?'#1c1c1c':'#ffffff',
        'inputTextColor' => $dark?'#ffffff':'#333333',
        'majorHeadingBg' => $dark?'#453725':'#fae2bc',
        'majorHeadingTextColor' => $dark?'#f2d9ae':'#654321',
        'minorHeadingTextColor' => $dark?'#d4d4ce':'#65655e',
        'buttonPrimaryBg' => $dark?'#256e60':'#087361',
        'buttonCtaBg' => $dark?'#996327':'#a45f09',
        'selectedItemBgColor' => $dark?'#37473f':'#e6f5ef',
        'selectedItemColor' => $dark?'#d6ece3':'#1a6357',
    ];
    foreach ($plain as $key=>$value) { $properties[$key] = $value; }
    foreach ($colors as $key=>$value) { $properties[$key] = ['default'=>$value]; }
    $known = $app->repository('XF:StyleProperty')->findPropertyMapInStyle($style)->fetch()->toArray();
    if ($unknown = array_diff(array_keys($properties), array_keys($known))) { throw new RuntimeException('Unknown native properties: ' . implode(', ', $unknown)); }
    $app->repository('XF:StyleProperty')->updatePropertyValues($style, $properties);
    $updateTemplate($style, 'storm_flexile.less', file_get_contents(__DIR__ . '/flexile.less'));
    $updateTemplate($style, 'storm_flexile_visitor', file_get_contents(__DIR__ . '/visitor.html'));
    $old = $app->finder('XF:Template')->where(['style_id'=>$style->style_id,'type'=>'public','title'=>'extra.less'])->fetchOne();
    if ($old) { $old->delete(); }
    $page = $app->finder('XF:Template')->where(['style_id'=>0,'type'=>'public','title'=>'PAGE_CONTAINER'])->fetchOne()->template;
    $page = str_replace('</head>', '<xf:css src="storm_flexile.less" />' . "\n</head>", $page, $headCount);
    $header = '<xf:if is="property(\'flexile_show_header_content\')"><div class="flexile-headerContent">{{ property(\'flexile_header_content\')|raw }}</div></xf:if>';
    $page = str_replace('<xf:ad position="container_header" />', $header . "\n\t\t\t<xf:ad position=\"container_header\" />", $page, $headerCount);
    $branding = '<div class="flexile-attribution">An Audentio Design design creation. · Adapted for The Storm</div>';
    $page = str_replace("{{ phrase('extra_copyright') }}", "{{ phrase('extra_copyright') }}\n" . $branding, $page, $footerCount);
    $page = str_replace('<xf:ad position="container_sidebar_above" />', '<xf:include template="storm_flexile_visitor" />' . "\n" . '<xf:ad position="container_sidebar_above" />', $page, $sidebarCount);
    if ($headCount !== 1 || $headerCount !== 1 || $footerCount !== 1 || $sidebarCount !== 1) { throw new RuntimeException('Native template anchors changed'); }
    $updateTemplate($style, 'PAGE_CONTAINER', $page, 'XF');
    $export = $app->service('XF:Style\Export', $style);
    $document = $export->exportToXml();
    $document->documentElement->setAttribute('storm_flexile_version','2.0.0');
    $document->documentElement->setAttribute('storm_flexile_mode',$mode);
    $zip = new ZipArchive();
    $file = $destination . '/flexile-storm-' . $mode . '.zip';
    if ($zip->open($file, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) { throw new RuntimeException('Private export could not be opened'); }
    $zip->addFromString('style.xml', $document->saveXML());
    $zip->setMtimeName('style.xml', 315532800);
    $zip->close();
    echo $mode . ' style ' . $style->style_id . ': ' . hash_file('sha256',$file) . "\n";
}
$app->repository('XF:Style')->triggerStyleDataRebuild();
