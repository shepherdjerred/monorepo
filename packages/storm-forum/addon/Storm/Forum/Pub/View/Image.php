<?php
namespace Storm\Forum\Pub\View;

final class Image extends \XF\Mvc\View
{
    public function renderRaw(): string { return file_get_contents($this->params['path']); }
}
