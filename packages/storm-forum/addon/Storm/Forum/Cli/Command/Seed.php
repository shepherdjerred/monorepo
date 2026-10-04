<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class Seed extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void { $this->setName('storm:seed')->setDescription('Publish the managed welcome, rules, and attributed history once.'); }
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $app = \XF::app();
        $map = $app->registry()->get('stormForumMap');
        if (!$map) { throw new \RuntimeException('Configure the forum before publishing'); }
        $author = $app->finder('XF:User')->where('is_admin', true)->order('user_id')->fetchOne();
        if (!$author) { throw new \RuntimeException('An editorial administrator is required'); }
        $seeds = json_decode(file_get_contents('/opt/storm-forum/config/seed-content.json'), true, 512, JSON_THROW_ON_ERROR);
        $published = $app->registry()->get('stormForumSeedThreads') ?: [];
        \XF::asVisitor($author, function () use ($app, $map, $seeds, &$published) {
            foreach ($seeds as $seed) {
                if (isset($published[$seed['key']])) {
                    if (!$app->em()->find('XF:Thread', $published[$seed['key']])) { throw new \RuntimeException('Managed editorial thread missing'); }
                    continue; // Preserve staff edits and the original publication date.
                }
                $forum = $app->em()->find('XF:Forum', $map['node:' . $seed['node']]);
                if (!$forum) { throw new \RuntimeException('Editorial forum missing'); }
                $creator = $app->service('XF:Thread\Creator', $forum);
                $creator->setContent($seed['title'], $seed['message']);
                $creator->setIsAutomated();
                $thread = $creator->save();
                $published[$seed['key']] = $thread->thread_id;
                $app->registry()->set('stormForumSeedThreads', $published);
            }
        });
        $output->writeln('Managed editorial content published; existing staff edits preserved.');
        return 0;
    }
}
