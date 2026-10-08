<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class Seed extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void { $this->setName('storm:seed')->setDescription('Retire generated launch content permanently.'); }
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $app = \XF::app();
        $map = $app->registry()->get('stormForumMap');
        if (!$map) { throw new \RuntimeException('Configure the forum before publishing'); }
        $author = $app->finder('XF:User')->where('is_admin', true)->order('user_id')->fetchOne();
        if (!$author) { throw new \RuntimeException('An editorial administrator is required'); }
        $seeds = json_decode(file_get_contents('/opt/storm-forum/config/seed-content.json'), true, 512, JSON_THROW_ON_ERROR);
        $published = $app->registry()->get('stormForumSeedThreads') ?: [];
        $retired = $app->registry()->get('stormForumRetiredSeeds') ?: [];
        \XF::asVisitor($author, function () use ($app, $seeds, $published, &$retired) {
            foreach ($seeds as $seed) {
                if (isset($retired[$seed['key']])) { continue; }
                if (isset($published[$seed['key']])) {
                    $thread = $app->em()->find('XF:Thread', $published[$seed['key']], ['FirstPost']);
                    $reviewedHashes = [hash('sha256', $seed['message'])];
                    if (isset($seed['previousMessageHash'])) { $reviewedHashes[] = $seed['previousMessageHash']; }
                    if (!$thread || $thread->title !== $seed['title'] || $thread->user_id !== $seed['authorId'] || $thread->reply_count !== 0
                        || !$thread->FirstPost || !in_array(hash('sha256', $thread->FirstPost->message), $reviewedHashes, true)) {
                        throw new \RuntimeException('Generated launch thread differs from its reviewed target');
                    }
                    if ($thread->discussion_state !== 'deleted') {
                        $app->service('XF:Thread\Deleter', $thread)->delete('soft', 'Generated launch content retired at owner request');
                    }
                }
                $retired[$seed['key']] = ['threadId'=>$published[$seed['key']] ?? null, 'retiredAt'=>time()];
                $app->registry()->set('stormForumRetiredSeeds', $retired);
            }
        });
        $output->writeln('Generated launch content retired; future releases will not recreate it.');
        return 0;
    }
}
