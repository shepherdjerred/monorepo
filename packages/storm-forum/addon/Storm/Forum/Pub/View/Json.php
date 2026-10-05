<?php
namespace Storm\Forum\Pub\View;

final class Json extends \XF\Mvc\View
{
    public function renderJson(): array { return $this->params['data']; }
}
