<?php
namespace Storm\Forum\Cli\Command;

use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/** Explicit editorial publication, separate from retired generated seed threads. */
final class Announce extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void
    {
        $this->setName('storm:announce')->setDescription('Preview the reviewed welcome announcement; --publish posts it once.')
            ->addOption('publish', null, InputOption::VALUE_NONE, 'Publish the reviewed announcement through the native thread service.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $announcement = json_decode(file_get_contents('/opt/storm-forum/config/welcome-announcement.json'), true, 512, JSON_THROW_ON_ERROR);
        $keys = array_keys($announcement); sort($keys);
        if ($keys !== ['authorId', 'key', 'message', 'node', 'title'] || !is_int($announcement['authorId'])
            || !is_string($announcement['key']) || !preg_match('/^[a-z0-9-]{1,64}$/', $announcement['key'])
            || $announcement['node'] !== 'news' || !is_string($announcement['title']) || trim($announcement['title']) === ''
            || !is_string($announcement['message']) || trim($announcement['message']) === '') {
            throw new \RuntimeException('The reviewed welcome announcement is invalid.');
        }
        $app = \XF::app();
        $author = $app->em()->find('XF:User', $announcement['authorId']);
        $map = $app->registry()->get('stormForumMap');
        $forum = $app->em()->find('XF:Forum', $map['node:news'] ?? 0);
        if (!$author || !$author->is_admin || $author->user_state !== 'valid' || !$forum) {
            throw new \RuntimeException('The editorial author and managed news forum must exist.');
        }
        return \XF::asVisitor($author, function () use ($app, $forum, $announcement, $input, $output): int {
            if (!$forum->canView() || !$forum->canCreateThread()) {
                throw new \RuntimeException('The editorial author cannot publish in the news forum.');
            }
            $db = $app->db();
            if (!$db->fetchOne('SELECT GET_LOCK(?, 10)', ['storm-welcome-announcement'])) {
                throw new \RuntimeException('Another announcement publication owns the lock.');
            }
            try {
                $published = $app->registry()->get('stormForumAnnouncements') ?: [];
                $id = $published[$announcement['key']] ?? null;
                if ($id !== null) {
                    $thread = $app->em()->find('XF:Thread', $id);
                    if (!$thread || $thread->node_id !== $forum->node_id || $thread->user_id !== $announcement['authorId']) {
                        throw new \RuntimeException('The published announcement differs from its recorded target.');
                    }
                    $output->writeln('Already published: ' . $app->router('public')->buildLink('canonical:threads', $thread));
                    return 0;
                }
                $creator = $app->service('XF:Thread\Creator', $forum);
                $creator->setContent($announcement['title'], $announcement['message']);
                if (!$creator->validate($errors)) {
                    throw new \RuntimeException('Native announcement validation failed: ' . implode('; ', $errors));
                }
                if (!$input->getOption('publish')) {
                    $output->writeln($announcement['title'] . "\n\n" . $announcement['message']);
                    $output->writeln('Preview only. Use --publish after live joining and the guide are verified.');
                    return 0;
                }
                $db->beginTransaction();
                try {
                    $thread = $creator->save();
                    $published[$announcement['key']] = $thread->thread_id;
                    $app->registry()->set('stormForumAnnouncements', $published);
                    $db->commit();
                } catch (\Throwable $error) {
                    $db->rollback();
                    throw $error;
                }
                $output->writeln('Published: ' . $app->router('public')->buildLink('canonical:threads', $thread));
                return 0;
            } finally {
                $db->fetchOne('SELECT RELEASE_LOCK(?)', ['storm-welcome-announcement']);
            }
        });
    }
}
