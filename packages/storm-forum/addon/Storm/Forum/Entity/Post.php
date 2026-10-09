<?php
namespace Storm\Forum\Entity;

use XF\Mvc\Entity\Structure;

class Post extends XFCP_Post
{
    public function getStormHistoricalRatings(): array
    {
        $capture = ($this->app()->registry()->get('stormHistoryRatings') ?: [])[$this->post_id] ?? [];
        if (!$capture) { return []; }
        $manifest = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $items = [];
        foreach ($manifest['reactions'] as $definition) {
            $count = $capture['counts'][$definition['key']] ?? 0;
            if ($count > 0) { $items[] = ['title'=>$definition['title'], 'emoji'=>$definition['emoji'], 'count'=>$count]; }
        }
        return $capture + ['items'=>$items, 'total'=>array_sum($capture['counts'])];
    }

    public static function getStructure(Structure $structure)
    {
        $structure = parent::getStructure($structure);
        $structure->getters['storm_historical_ratings'] = ['getter'=>'getStormHistoricalRatings', 'cache'=>true];
        return $structure;
    }
}
