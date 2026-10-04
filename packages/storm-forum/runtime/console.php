<?php
function stormConsoleCleanup(): void
{
    XF::triggerRunOnce(true);
    $app = XF::app();
    if (!$app->container()->isCached('job.manager')) { return; }
    $manager = $app->jobManager();
    foreach (array_keys($manager->getManualEnqueued()) as $id) {
        while ($result = $manager->runById($id, XF::config('jobMaxRunTime'))) {
            if ($result->result === XF\Job\JobResult::RESULT_FAILED || $result->continueDate) {
                throw new RuntimeException('Required release rebuild did not complete');
            }
            $app->em()->clearEntityCache();
            XF::updateTime();
        }
    }
}
$console = new Symfony\Component\Console\Application('XenForo', XF::$version);
$console->setAutoExit(false);
$console->setCatchExceptions(false);
$runner = new class extends XF\Cli\Runner {
    public function registerAll(Symfony\Component\Console\Application $console): void {
        $this->registerCommands($console);
    }
};
$runner->registerAll($console);
return $console;
