<?php
namespace Storm\Forum\Entity;

use XF\Mvc\Entity\Structure;

class Thread extends XFCP_Thread
{
    public function getStormHistoricalPoll(): array
    {
        return ($this->app()->registry()->get('stormHistoryPolls') ?: [])[$this->thread_id] ?? [];
    }

    public static function getStructure(Structure $structure)
    {
        $structure = parent::getStructure($structure);
        $structure->getters['storm_historical_poll'] = ['getter'=>'getStormHistoricalPoll', 'cache'=>true];
        return $structure;
    }
}
