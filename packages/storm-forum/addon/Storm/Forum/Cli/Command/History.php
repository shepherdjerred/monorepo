<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class History extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void
    {
        $this->setName('storm:history')->setDescription('Restore public discussions, profile-only identities, and recovered media.')
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Validate and report without writing.')
            ->addOption('migrate', null, InputOption::VALUE_NONE, 'Apply a reviewed corpus revision, preserving edited messages and native IDs.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $app = \XF::app(); $db = $app->db();
        $history = json_decode(file_get_contents('/opt/storm-forum/config/history.json'), true, 512, JSON_THROW_ON_ERROR);
        if ($history['version'] !== 2) { throw new \RuntimeException('Unknown history corpus version'); }
        $nodes = $app->registry()->get('stormForumMap');
        $read = static fn(string $key) => (new \XF\DataRegistry($db))->get($key) ?: [];
        $map = $read('stormForumHistory'); $users = $read('stormForumHistoricalUsers');
        self::assertMappedPostsRetained($history, $map);
        $assets = array_column($history['attachments'], null, 'originalId');
        $identities = array_column($history['users'], null, 'originalId');
        foreach ($identities as $id=>$item) {
            if (isset($users[$id])) {
                if (!$app->em()->find('XF:User', $users[$id]['userId'])) { throw new \RuntimeException('Historical profile missing'); }
            } elseif ($app->finder('XF:User')->where('username', $item['aliases'])->fetchOne()) {
                throw new \RuntimeException('Historical username collision requires an explicit identity mapping: ' . $item['username']);
            }
            if ($item['avatar'] !== null && (!preg_match('/^avatar-\d+\.(jpg|png)$/D', $item['avatar']) || !getimagesize('/opt/storm-forum/assets/history/' . $item['avatar']))) {
                throw new \RuntimeException('Invalid historical avatar');
            }
        }
        foreach ($assets as $asset) {
            if (!preg_match('/^attachment-\d+\.(jpg|png|gif)$/D', $asset['file']) || basename($asset['filename']) !== $asset['filename']
                || hash_file('sha256', '/opt/storm-forum/assets/history/' . $asset['file']) !== $asset['sha256']
                || !getimagesize('/opt/storm-forum/assets/history/' . $asset['file'])) { throw new \RuntimeException('Invalid historical attachment'); }
        }
        foreach ($history['threads'] as $record) {
            if (!in_array($record['node'], ['news','general','feedback','bugs','games'], true)
                || !$app->em()->find('XF:Forum', $nodes['node:' . $record['node']] ?? 0) || !$record['posts']) {
                throw new \RuntimeException('Historical discussion targets an invalid public forum');
            }
            $entry = $map[$record['originalId']] ?? null;
            if ($entry && !$app->em()->find('XF:Thread', $entry['threadId'])) { throw new \RuntimeException('Imported discussion missing'); }
            if (($entry['version'] ?? null) === 2 && $entry['hash'] !== self::hash($record) && !$input->getOption('migrate')) { throw new \RuntimeException('Imported corpus changed; explicit migration required'); }
            foreach ($record['posts'] as $post) {
                if (!isset($identities[$post['originalUserId']]) || !in_array($post['author'], $identities[$post['originalUserId']]['aliases'], true)
                    || !array_key_exists('originalPostId', $post) || ($post['originalPostId'] !== null && (!is_int($post['originalPostId']) || $post['originalPostId'] <= 0))
                    || !is_int($post['date']) || $post['date'] <= 0 || $post['date'] >= time() || trim($post['message']) === ''
                    || array_diff($post['attachments'], array_keys($assets))) { throw new \RuntimeException('Invalid historical post metadata'); }
                if ($entry) {
                    $native = $app->em()->find('XF:Post', $entry['posts'][$post['key']] ?? 0);
                    if (!$native || $native->thread_id !== $entry['threadId'] || $native->post_date !== $post['date'] || $native->username !== $post['author']) {
                        throw new \RuntimeException('Historical post identity/date mapping changed');
                    }
                }
            }
        }
        $output->writeln(count($history['threads']) . ' public discussions; ' . count($identities) . ' profile-only identities; ' . count($assets) . ' recovered attachments.');
        if ($input->getOption('dry-run')) { return 0; }
        if (!$db->fetchOne('SELECT GET_LOCK(?, 0)', 'storm-history-import')) { throw new \RuntimeException('Another history import is running'); }
        try {
            $map = $read('stormForumHistory'); $users = $read('stormForumHistoricalUsers');
            self::assertMappedPostsRetained($history, $map);
            foreach ($identities as $id=>$item) {
                if (isset($users[$id])) { continue; }
                $db->beginTransaction();
                try {
                    if ($app->finder('XF:User')->where('username', $item['aliases'])->fetchOne()) { throw new \RuntimeException('Historical username collision'); }
                    $user = $app->repository('XF:User')->setupBaseUser();
                    $user->setOption('admin_edit', true);
                    $user->bulkSet(['username'=>$item['username'], 'email'=>'', 'user_state'=>'valid', 'user_group_id'=>2, 'last_activity'=>0]);
                    // Native NoPassword authentication creates no credential or account-claim path.
                    $user->Auth->setNoPassword();
                    $user->save();
                    if ($item['avatar'] !== null) {
                        $avatar = $app->service('XF:User\Avatar', $user); $avatar->logIp(false); $avatar->logChange(false); $avatar->silentRunning(true);
                        if (!$avatar->setImage('/opt/storm-forum/assets/history/' . $item['avatar']) || !$avatar->updateAvatar()) { throw new \RuntimeException('Historical avatar import failed'); }
                    }
                    $users[$id] = ['userId'=>$user->user_id, 'slugs'=>$item['slugs'], 'aliases'=>$item['aliases']];
                    $app->registry()->set('stormForumHistoricalUsers', $users); $db->commit();
                } catch (\Throwable $error) { $db->rollback(); throw $error; }
                $app->em()->clearEntityCache();
            }
            // Reserve all native IDs before rewriting cross-discussion links.
            foreach ($history['threads'] as $record) {
                $id = $record['originalId']; if (isset($map[$id])) { continue; }
                $db->beginTransaction();
                try {
                    $first = $record['posts'][0]; $forum = $app->em()->find('XF:Forum', $nodes['node:' . $record['node']]);
                    $thread = $app->em()->create('XF:Thread'); $thread->setOption('log_moderator', false);
                    $thread->bulkSet(['node_id'=>$forum->node_id, 'title'=>$record['title'], 'user_id'=>$users[$first['originalUserId']]['userId'],
                        'username'=>$first['author'], 'post_date'=>$first['date'], 'discussion_open'=>true, 'discussion_state'=>'visible',
                        'discussion_type'=>$forum->TypeHandler->getDefaultThreadType($forum)]); $thread->save();
                    $posts = []; $hashes = [];
                    foreach ($record['posts'] as $position=>$item) {
                        $post = $app->em()->create('XF:Post'); $post->setOption('log_moderator', false);
                        $post->bulkSet(['thread_id'=>$thread->thread_id, 'user_id'=>$users[$item['originalUserId']]['userId'], 'username'=>$item['author'],
                            'post_date'=>$item['date'], 'message'=>$item['message'], 'message_state'=>'visible', 'position'=>$position]); $post->save();
                        if ($position === 0) { $thread->first_post_id = $post->post_id; $thread->save(); }
                        $posts[$item['key']] = $post->post_id; $hashes[$item['key']] = hash('sha256', $item['message']);
                    }
                    $thread->reply_count = count($record['posts']) - 1; $thread->save();
                    $map[$id] = ['threadId'=>$thread->thread_id, 'slug'=>$record['slug'], 'hash'=>self::hash($record), 'posts'=>$posts, 'messageHashes'=>$hashes, 'version'=>0];
                    $app->registry()->set('stormForumHistory', $map); $db->commit();
                } catch (\Throwable $error) { $db->rollback(); throw $error; }
                $app->em()->clearEntityCache();
            }
            $postLinks = []; $ambiguousPosts = [];
            foreach ($history['threads'] as $record) {
                foreach ($record['posts'] as $post) {
                    if ($post['originalPostId'] === null) { continue; }
                    $original = $post['originalPostId']; $native = $map[$record['originalId']]['posts'][$post['key']];
                    $map[$record['originalId']]['originalPosts'][$original] = $native;
                    // Different archive eras can reuse post IDs. Only unambiguous direct links can be rewritten.
                    if (isset($postLinks[$original])) { $ambiguousPosts[$original] = true; }
                    $postLinks[$original] = $native;
                }
            }
            foreach ($ambiguousPosts as $original=>$_) { unset($postLinks[$original]); }
            foreach ($history['threads'] as $record) {
                $id = $record['originalId']; $entry = $map[$id];
                if (($entry['version'] ?? null) === 2) {
                    if ($entry['hash'] === self::hash($record)) { continue; }
                    if (!$input->getOption('migrate')) { throw new \RuntimeException('Imported corpus changed; explicit migration required'); }
                }
                $db->beginTransaction();
                try {
                    foreach ($record['posts'] as $item) {
                        $postId = $entry['posts'][$item['key']];
                        $current = $db->fetchOne('SELECT message FROM xf_post WHERE post_id = ? FOR UPDATE', $postId);
                        $post = $app->em()->find('XF:Post', $postId); $post->setOption('log_moderator', false);
                        $userId = $users[$item['originalUserId']]['userId'];
                        if ($post->user_id && $post->user_id !== $userId) { throw new \RuntimeException('Historical post has conflicting account ownership'); }
                        $post->user_id = $userId;
                        foreach ($item['attachments'] as $assetId) {
                            if (isset($entry['attachments'][$item['key']][$assetId])) { continue; }
                            $asset = $assets[$assetId];
                            $preparer = $app->service('XF:Attachment\Preparer');
                            $data = $preparer->insertDataFromFile(new \XF\FileWrapper('/opt/storm-forum/assets/history/' . $asset['file'], $asset['filename']), $userId, ['upload_date'=>$item['date']]);
                            $attachment = $app->em()->create('XF:Attachment');
                            $attachment->bulkSet(['data_id'=>$data->data_id, 'content_type'=>'post', 'content_id'=>$postId, 'attach_date'=>$item['date'], 'unassociated'=>false]);
                            $attachment->save(); $entry['attachments'][$item['key']][$assetId] = $attachment->attachment_id;
                        }
                        $expected = $entry['messageHashes'][$item['key']] ?? $item['previousMessageHash'];
                        if (hash('sha256', $current) === $expected) {
                            $message = self::rewriteLinks($item['message'], $app, $map, $users, $postLinks, $entry['attachments'][$item['key']] ?? []);
                            $message = preg_replace_callback('/\[ATTACH\](\d+)\[\/ATTACH\]/', static function ($match) use ($entry, $item) {
                                $native = $entry['attachments'][$item['key']][(int)$match[1]] ?? null;
                                if (!$native) { throw new \RuntimeException('Missing native attachment mapping'); }
                                return '[ATTACH type="full"]' . $native . '[/ATTACH]';
                            }, $message);
                            $post->message = $message; $entry['messageHashes'][$item['key']] = hash('sha256', $message);
                        } else { $entry['conflicts'][$item['key']] = 'Staff-edited message retained; recovered formatting available in the corpus'; }
                        $post->attach_count = (int)$db->fetchOne('SELECT COUNT(*) FROM xf_attachment WHERE content_type = ? AND content_id = ?', ['post', $postId]);
                        $post->save();
                    }
                    $first = $record['posts'][0];
                    $db->update('xf_thread', ['user_id'=>$users[$first['originalUserId']]['userId']], 'thread_id = ?', $entry['threadId']);
                    $app->repository('XF:Thread')->rebuildThreadUserPostCounters($entry['threadId']);
                    $entry['version'] = 2; $entry['hash'] = self::hash($record); $map[$id] = $entry;
                    $app->registry()->set('stormForumHistory', $map); $db->commit();
                } catch (\Throwable $error) { $db->rollback(); throw $error; }
                $app->em()->clearEntityCache();
            }
            foreach ($users as $item) {
                $db->query('UPDATE xf_user SET message_count = (SELECT COUNT(*) FROM xf_post p INNER JOIN xf_thread t ON t.thread_id = p.thread_id INNER JOIN xf_forum f ON f.node_id = t.node_id WHERE p.user_id = ? AND p.message_state = ? AND t.discussion_state = ? AND f.count_messages = 1) WHERE user_id = ?', [$item['userId'], 'visible', 'visible', $item['userId']]);
            }
            foreach ($map as $entry) {
                $thread = $app->em()->find('XF:Thread', $entry['threadId']);
                $thread->rebuildCounters(); $thread->save();
            }
            $app->em()->clearEntityCache();
        } finally { $db->query('SELECT RELEASE_LOCK(?)', 'storm-history-import'); }
        $conflicts = array_sum(array_map(static fn($item) => count($item['conflicts'] ?? []), $map));
        $output->writeln('Historical profiles, discussions, and media restored; ' . $conflicts . ' edited messages preserved.');
        return 0;
    }

    private static function assertMappedPostsRetained(array $history, array $map): void
    {
        $threads = array_column($history['threads'], null, 'originalId');
        foreach ($map as $id=>$entry) {
            if (!isset($threads[$id]) || array_diff(array_keys($entry['posts']), array_column($threads[$id]['posts'], 'key'))) {
                throw new \RuntimeException('Corpus revision removes mapped historical posts; use native moderation without dropping import mappings.');
            }
        }
    }

    private static function hash(array $record): string { return hash('sha256', json_encode($record, JSON_THROW_ON_ERROR)); }

    private static function rewriteLinks(string $message, \XF\App $app, array $threads, array $users, array $posts, array $attachments): string
    {
        return preg_replace_callback('/\[URL=(https?:\/\/ts-mc\.net(?::80)?\/[^\]]+)\]/i', static function ($match) use ($app, $threads, $users, $posts, $attachments) {
            $url = $match[1]; $path = parse_url($url, PHP_URL_PATH); $native = null;
            if (preg_match('#^/threads/(?:[^/]+\.)?(\d+)(?:/|$)#', $path, $id) && isset($threads[(int)$id[1]])) {
                $thread = $app->em()->find('XF:Thread', $threads[(int)$id[1]]['threadId']);
                $native = $app->router('public')->buildLink('canonical:threads', $thread);
                if (preg_match('/#post-(\d+)/', $url, $anchor)) {
                    $post = $threads[(int)$id[1]]['originalPosts'][(int)$anchor[1]] ?? null;
                    if ($post) { $native .= '#post-' . $post; }
                }
            } elseif (preg_match('#^/members/[^/]+\.(\d+)(?:/|$)#', $path, $id) && isset($users[(int)$id[1]])) {
                $native = $app->router('public')->buildLink('canonical:members', $app->em()->find('XF:User', $users[(int)$id[1]]['userId']));
            } elseif (preg_match('#^/posts/(\d+)(?:/|$)#', $path, $id) && isset($posts[$id[1]])) {
                $native = $app->router('public')->buildLink('canonical:posts', $app->em()->find('XF:Post', $posts[$id[1]]));
            } elseif (preg_match('#^/attachments/[^/]+\.(\d+)(?:/|$)#', $path, $id) && isset($attachments[(int)$id[1]])) {
                $native = $app->router('public')->buildLink('canonical:attachments', $app->em()->find('XF:Attachment', $attachments[(int)$id[1]]));
            }
            return '[URL=' . ($native ?: $url) . ']';
        }, $message);
    }
}
