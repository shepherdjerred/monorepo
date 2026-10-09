<?php
namespace Storm\Forum\Service;

// Extend the native ACP merge, including its resumable background job.
class UserMerge extends XFCP_UserMerge
{
    public function merge($maxRunTime = 0)
    {
        $source = $this->getSource(); $target = $this->getTarget();
        if (!$source || !$target) { throw new \LogicException('Both merge accounts are required'); }
        if ($source->user_id === $target->user_id) { return parent::merge($maxRunTime); }
        $registry = $this->app->registry();
        $users = $registry->get('stormForumHistoricalUsers') ?: [];
        $originalUsers = $users;
        $identities = array_filter($users, fn($entry) => $entry['userId'] === $source->user_id);
        if (!$identities) {
            foreach ($users as $entry) {
                if ($entry['userId'] === $target->user_id && empty($entry['claimed'])) {
                    throw new \RuntimeException('Merge the archived profile into a verified active account, not the reverse.');
                }
            }
            return parent::merge($maxRunTime);
        }
        if ($target->user_state !== 'valid' || $target->email === '') {
            throw new \RuntimeException('The surviving account must have a verified email address.');
        }
        $db = $this->db();
        if ($db->inTransaction()) { throw new \LogicException('Historical merges require their own transaction'); }
        if (!$db->fetchOne('SELECT GET_LOCK(?, 0)', 'storm-history-import')) {
            throw new \RuntimeException('Historical account import or merge is already running.');
        }
        try {
            $fresh = new \XF\DataRegistry($db);
            if ($fresh->get('stormForumHistoricalUsers') !== $users || !$db->fetchOne('SELECT user_id FROM xf_user WHERE user_id = ?', $source->user_id)) {
                throw new \RuntimeException('Historical ownership changed; reload the accounts before merging.');
            }
            $pending = $fresh->get('stormForumHistoricalMerge');
            $operation = ['source'=>$source->user_id, 'target'=>$target->user_id];
            if ($pending && $pending !== $operation) { throw new \RuntimeException('Finish the existing historical account merge first.'); }
            $history = json_decode(file_get_contents('/opt/storm-forum/config/history.json'), true, 512, JSON_THROW_ON_ERROR);
            $map = $fresh->get('stormForumHistory');
            if (!is_array($map)) { throw new \RuntimeException('Import history before merging archived accounts.'); }
            $db->beginTransaction();
            try {
                $registry->set('stormForumHistoricalMerge', $operation);
                $result = parent::merge($maxRunTime);
                // XF changes cached author names during reassignment. Restore only mapped
                // archive labels; current posts keep the active account's current name.
                $forums = [];
                $this->app->em()->clearEntityCache();
                foreach ($history['threads'] as $record) {
                    $prefix = ($record['era'] ?? 'original') === 'original' ? '' : $record['era'] . ':';
                    $threadKey = $prefix . $record['originalId'];
                    $changed = false;
                    foreach ($record['posts'] as $post) {
                        if (!isset($identities[$prefix . $post['originalUserId']])) { continue; }
                        $postId = $map[$threadKey]['posts'][$post['key']] ?? null;
                        if (!$postId) { throw new \RuntimeException('Historical merge has a missing post mapping.'); }
                        $db->query('UPDATE xf_post SET username = ? WHERE post_id = ? AND user_id = ?', [$post['author'], $postId, $target->user_id]);
                        $changed = true;
                    }
                    if (!$changed) { continue; }
                    $thread = $this->app->em()->find('XF:Thread', $map[$threadKey]['threadId'], ['Forum']);
                    if (!$thread) { throw new \RuntimeException('Historical merge has a missing discussion.'); }
                    $thread->rebuildCounters(); $thread->save();
                    $forums[$thread->node_id] = $thread->Forum;
                    $this->app->repository('XF:Thread')->rebuildThreadUserPostCounters($thread->thread_id);
                }
                foreach ($forums as $forum) { $forum->rebuildLastPost(); $forum->save(); }
                if ($result->isCompleted()) {
                    foreach ($identities as $id=>$entry) {
                        $entry['userId'] = $target->user_id;
                        $entry['claimed'] = true;
                        $entry['retiredUserIds'] = array_values(array_unique(array_merge($entry['retiredUserIds'] ?? [], [$source->user_id])));
                        $users[$id] = $entry;
                    }
                    $registry->set('stormForumHistoricalUsers', $users);
                    $registry->delete('stormForumHistoricalMerge');
                    $this->app->repository('XF:UserGroupPromotion')->updatePromotionsForUser($target);
                }
                $db->commit();
                $this->app->em()->clearEntityCache();
                return $result;
            } catch (\Throwable $error) {
                $db->rollbackAll();
                $registry->set('stormForumHistoricalUsers', $originalUsers);
                if ($pending) { $registry->set('stormForumHistoricalMerge', $pending); }
                else { $registry->delete('stormForumHistoricalMerge'); }
                $this->app->em()->clearEntityCache();
                throw $error;
            }
        } finally { $db->query('SELECT RELEASE_LOCK(?)', 'storm-history-import'); }
    }
}
