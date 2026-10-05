<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class History extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void
    {
        $this->setName('storm:history')->setDescription('Restore reviewed public discussions without creating accounts.')
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Validate and report without writing.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $app = \XF::app();
        $history = json_decode(file_get_contents('/opt/storm-forum/config/history.json'), true, 512, JSON_THROW_ON_ERROR);
        if ($history['version'] !== 1) { throw new \RuntimeException('Unknown history corpus version'); }
        $nodes = $app->registry()->get('stormForumMap');
        $map = $app->registry()->get('stormForumHistory') ?: [];
        $pending = [];
        foreach ($history['threads'] as $record) {
            if (!in_array($record['node'], ['news','general','feedback','bugs','games'], true)) { throw new \RuntimeException('History targets a non-public forum'); }
            $forum = $app->em()->find('XF:Forum', $nodes['node:' . $record['node']] ?? 0);
            if (!$forum || !$record['posts']) { throw new \RuntimeException('Historical discussion has no forum or posts'); }
            $id = $record['originalId'];
            $hash = hash('sha256', json_encode($record, JSON_THROW_ON_ERROR));
            if (isset($map[$id])) {
                if ($map[$id]['hash'] !== $hash) { throw new \RuntimeException('Imported corpus changed; explicit migration required'); }
                if (!$app->em()->find('XF:Thread', $map[$id]['threadId'])) { throw new \RuntimeException('Imported discussion missing'); }
                continue;
            }
            foreach ($record['posts'] as $post) {
                if (!is_int($post['date']) || $post['date'] <= 0 || $post['date'] >= time() || !is_string($post['message']) || trim($post['message']) === '' || !is_string($post['author']) || $post['author'] === '') {
                    throw new \RuntimeException('Historical post metadata is invalid');
                }
            }
            $pending[] = [$record, $hash];
        }
        $output->writeln(count($history['threads']) . ' reviewed public discussions; ' . count($pending) . ' pending.');
        if ($input->getOption('dry-run')) { return 0; }
        // A DB advisory lock serializes release retries; each complete discussion commits with its ID map.
        if (!$app->db()->fetchOne('SELECT GET_LOCK(?, 0)', 'storm-history-import')) { throw new \RuntimeException('Another history import is running'); }
        try {
            // Bypass the process-local registry cache after locking: another import may have just committed.
            $map = (new \XF\DataRegistry($app->db()))->get('stormForumHistory') ?: [];
            foreach ($pending as [$record, $hash]) {
                $id = $record['originalId'];
                if (isset($map[$id])) {
                    if ($map[$id]['hash'] !== $hash) { throw new \RuntimeException('Imported corpus changed; explicit migration required'); }
                    if (!$app->em()->find('XF:Thread', $map[$id]['threadId'])) { throw new \RuntimeException('Imported discussion missing'); }
                    continue;
                }
                $db = $app->db();
                $db->beginTransaction();
                try {
                    $first = $record['posts'][0];
                    $forum = $app->em()->find('XF:Forum', $nodes['node:' . $record['node']]);
                    $thread = $app->em()->create('XF:Thread');
                    $thread->setOption('log_moderator', false);
                    $thread->bulkSet(['node_id'=>$forum->node_id, 'title'=>$record['title'], 'user_id'=>0,
                        'username'=>$first['author'], 'post_date'=>$first['date'], 'discussion_open'=>true,
                        'discussion_state'=>'visible', 'discussion_type'=>$forum->TypeHandler->getDefaultThreadType($forum)]);
                    $thread->save();
                    $postMap = [];
                    foreach ($record['posts'] as $position=>$item) {
                        $post = $app->em()->create('XF:Post');
                        $post->setOption('log_moderator', false);
                        $post->bulkSet(['thread_id'=>$thread->thread_id, 'user_id'=>0, 'username'=>$item['author'],
                            'post_date'=>$item['date'], 'message'=>$item['message'], 'message_state'=>'visible', 'position'=>$position]);
                        $post->save();
                        if ($position === 0) { $thread->first_post_id = $post->post_id; $thread->save(); }
                        $postMap[$item['key']] = $post->post_id;
                    }
                    $thread->reply_count = count($record['posts']) - 1;
                    $thread->save();
                    $map[$id] = ['threadId'=>$thread->thread_id, 'slug'=>$record['slug'], 'hash'=>$hash, 'posts'=>$postMap];
                    $app->registry()->set('stormForumHistory', $map);
                    $db->commit();
                    $app->em()->clearEntityCache();
                } catch (\Throwable $error) { $db->rollback(); throw $error; }
            }
        } finally { $app->db()->query('SELECT RELEASE_LOCK(?)', 'storm-history-import'); }
        $output->writeln('Historical discussions restored; original names/dates and later edits preserved.');
        return 0;
    }
}
