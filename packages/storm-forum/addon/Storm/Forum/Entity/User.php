<?php
namespace Storm\Forum\Entity;

use XF\Mvc\Entity\Structure;

class User extends XFCP_User
{
    public function getStormHistorical(): bool
    {
        foreach ($this->app()->registry()->get('stormForumHistoricalUsers') ?: [] as $identity) {
            if ($identity['userId'] === $this->user_id) { return true; }
        }
        return false;
    }

    public static function getStructure(Structure $structure)
    {
        $structure = parent::getStructure($structure);
        $structure->getters['storm_historical'] = ['getter'=>'getStormHistorical', 'cache'=>true];
        return $structure;
    }
}
