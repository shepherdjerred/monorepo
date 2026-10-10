<?php
namespace Storm\Forum\Pub\Controller;

final class Status extends \XF\Pub\Controller\AbstractController
{
    public function actionIndex(): \XF\Mvc\Reply\View
    {
        $status = \Storm\Forum\Service\MinecraftStatus::read();
        $html = $this->app()->templater()->renderTemplate('public:storm_minecraft_status', ['status'=>$status]);
        $this->app()->response()->setHeaders(['Cache-Control'=>'no-store']);
        $reply = $this->view('Storm\Forum:Json', '', ['data'=>['status'=>$status, 'html'=>$html]]);
        $reply->setResponseType('json');
        return $reply;
    }
}
