<?php
namespace Storm\Forum\Service;

final class Configuration extends \XF\Service\AbstractService
{
    private array $map = [];

    public function apply(array $manifest, string $stage): void
    {
        $this->map = $this->app->registry()->get('stormForumMap') ?: [];
        $db = $this->db();
        $db->beginTransaction();
        try {
            $this->groups($manifest);
            $this->nodes($manifest);
            $this->options($manifest, $stage);
            $this->widgets();
            $this->navigation();
            $this->app->registry()->set('stormForumMap', $this->map);
            $this->app->registry()->set('stormForumConfigured', $manifest['schemaVersion']);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollback();
            throw $e;
        }
        $this->app->jobManager()->enqueueUnique('stormPermissions', 'XF:PermissionRebuild');
    }

    private function managed(string $key, string $type): \XF\Mvc\Entity\Entity
    {
        if (isset($this->map[$key])) {
            $entity = $this->em()->find($type, $this->map[$key]);
            if (!$entity) { throw new \RuntimeException("Managed entity missing: {$key}"); }
            return $entity;
        }
        return $this->em()->create($type);
    }

    private function remember(string $key, \XF\Mvc\Entity\Entity $entity): void
    {
        $this->map[$key] = $entity->getEntityId();
    }

    private function permissions(int $groupId, array $values, ?int $nodeId = null): void
    {
        // XF silently ignores misspelled permission IDs. Check every managed ID first.
        $available = $this->repository('XF:Permission')->getPermissionsGrouped();
        foreach ($values as $group => $permissions) {
            foreach ($permissions as $permission => $_) {
                if (!isset($available[$group][$permission])) {
                    throw new \RuntimeException("Unknown XenForo permission: {$group}.{$permission}");
                }
            }
        }
        $service = $this->service('XF:UpdatePermissions');
        $service->setUserGroup($this->em()->find('XF:UserGroup', $groupId));
        if ($nodeId !== null) { $service->setContent('node', $nodeId); }
        $service->updatePermissions($values);
    }

    private function groups(array $manifest): void
    {
        $trusted = $this->managed('group:trusted', 'XF:UserGroup');
        $trusted->title = 'Established Members';
        $trusted->display_style_priority = 5;
        $trusted->save();
        $this->remember('group:trusted', $trusted);
        // "unset" allows the established secondary group to grant permissions;
        // a global "deny" would override its grants permanently.
        $this->permissions(2, [
            'general' => ['submitWithoutApproval' => 'unset', 'editSignature' => 'unset'],
            'conversation' => ['start' => 'unset', 'receive' => 'allow'],
            'profilePost' => ['post' => 'unset', 'comment' => 'unset'],
        ]);
        $this->permissions($trusted->user_group_id, [
            'general' => ['submitWithoutApproval' => 'allow', 'editSignature' => 'allow'],
            'conversation' => ['start' => 'allow'],
            'profilePost' => ['post' => 'allow', 'comment' => 'allow'],
        ]);
        foreach ([3, 4] as $staffId) {
            $this->permissions($staffId, ['general' => ['submitWithoutApproval' => 'allow', 'requireTfa' => 'allow']]);
        }
        $promotion = $this->managed('promotion:trusted', 'XF:UserGroupPromotion');
        $promotion->title = 'The Storm: established member';
        $promotion->active = true;
        $promotion->user_criteria = [
            ['rule' => 'messages_posted', 'data' => ['messages' => $manifest['registration']['approvedPosts']]],
            ['rule' => 'registered_days', 'data' => ['days' => $manifest['registration']['accountAgeHours'] / 24]],
        ];
        $promotion->extra_user_group_ids = [$trusted->user_group_id];
        $promotion->save();
        $this->remember('promotion:trusted', $promotion);
    }

    private function nodes(array $manifest): void
    {
        foreach ($manifest['nodes'] as $order => $definition) {
            $node = $this->managed('node:' . $definition['key'], 'XF:Node');
            $node->title = $definition['title'];
            $node->node_type_id = $definition['type'];
            $node->node_name = $definition['key'];
            $node->parent_node_id = isset($definition['parent']) ? $this->map['node:' . $definition['parent']] : 0;
            $node->display_order = ($order + 1) * 10;
            $data = $node->getDataRelationOrDefault();
            if ($definition['type'] === 'Forum') {
                $data->forum_type_id = !empty($definition['article']) ? 'article' : 'discussion';
                $data->count_messages = $definition['countMessages'] ?? true;
                $private = in_array($definition['access'], ['author-staff', 'staff'], true);
                $data->find_new = !$private;
                $data->allow_index = $private ? 'deny' : 'allow';
                $data->allowed_watch_notifications = $private ? 'none' : 'all';
            }
            $node->save();
            // New parents start with lft/rgt = 0. Materialize the native tree before
            // creating their children so XF can validate the parent relationship.
            $this->service('XF:Node\RebuildNestedSet', 'XF:Node', ['parentField' => 'parent_node_id'])->rebuildNestedSetInfo();
            $this->remember('node:' . $definition['key'], $node);
            if ($definition['type'] !== 'Forum') { continue; }
            $id = $node->node_id;
            $access = $definition['access'];
            if (in_array($access, ['public', 'announcements'], true)) {
                $this->permissions(1, ['forum' => ['viewAttachment' => 'content_allow']], $id);
            }
            if ($access === 'author-staff') {
                // The native viewOthers gate protects thread queries, search and attachments.
                // Reset inherited grants at this node; staff can explicitly grant them back.
                $this->permissions(1, ['general' => ['viewNode' => 'reset']], $id);
                $this->permissions(2, ['forum' => ['viewOthers' => 'reset']], $id);
                $this->permissions($this->map['group:trusted'], ['forum' => ['viewOthers' => 'reset']], $id);
                foreach ([3, 4] as $staffId) {
                    $this->permissions($staffId, ['general' => ['viewNode' => 'content_allow'], 'forum' => ['viewOthers' => 'content_allow']], $id);
                }
            } elseif ($access === 'staff') {
                foreach ([1, 2, $this->map['group:trusted']] as $groupId) {
                    $this->permissions($groupId, ['general' => ['viewNode' => 'reset']], $id);
                }
                foreach ([3, 4] as $staffId) {
                    $this->permissions($staffId, ['general' => ['viewNode' => 'content_allow']], $id);
                }
            } elseif ($access === 'announcements') {
                foreach ([1, 2, $this->map['group:trusted']] as $groupId) {
                    $this->permissions($groupId, ['forum' => ['postThread' => 'reset']], $id);
                }
                foreach ([3, 4] as $staffId) {
                    $this->permissions($staffId, ['forum' => ['postThread' => 'content_allow']], $id);
                }
            }
        }
    }

    private function options(array $manifest, string $stage): void
    {
        $url = $manifest['stages'][$stage]['url'];
        $updates = [
            'boardTitle' => $manifest['title'], 'boardUrl' => $url,
            'indexRoute' => 'storm-home/', 'useFriendlyUrls' => true,
            'defaultEmailAddress' => $manifest['sender'], 'contactEmailAddress' => $manifest['sender'],
            'registrationTimer' => $manifest['registration']['timerSeconds'],
            'registrationSetup' => ['enabled' => false, 'emailConfirmation' => true, 'moderation' => false, 'requireDob' => false, 'minimumAge' => 13],
            'captcha' => 'Turnstile', 'jobRunTrigger' => 'cron',
            'adminRequireTfa' => true,
            'attachmentMaxFileSize' => $manifest['attachmentLimitKiB'],
            'stopForumSpam' => ['enabled' => true, 'denyThreshold' => 3, 'moderateThreshold' => 1, 'frequencyCutOff' => 5, 'lastSeenCutOff' => 7, 'hashEmail' => true, 'submitRejections' => false, 'apiKey' => false],
        ];
        $repository = $this->repository('XF:Option');
        foreach ($updates as $key => $value) {
            if (!$this->em()->find('XF:Option', $key)) { throw new \RuntimeException("Unknown option: {$key}"); }
            $repository->updateOption($key, $value);
        }
    }

    private function widgets(): void
    {
        $widget = $this->managed('widget:recent', 'XF:Widget');
        $widget->widget_key = 'storm_recent_threads';
        $widget->definition_id = 'new_threads';
        $widget->options = ['limit' => 5, 'node_ids' => array_map(fn($key) => $this->map['node:' . $key], ['news', 'rules', 'general', 'feedback', 'bugs', 'games'])];
        $widget->save();
        $phrase = $widget->getMasterPhrase();
        $phrase->phrase_text = 'Recent discussions';
        $phrase->save();
        $this->remember('widget:recent', $widget);
    }

    private function navigation(): void
    {
        foreach (['stormHome' => ['Home', '{{ link(\'storm-home\') }}'], 'stormDocs' => ['Docs', 'https://docs.ts-mc.net'], 'stormMap' => ['LiveMap', 'https://bluemap.ts-mc.net']] as $key => [$title, $link]) {
            $nav = $this->em()->find('XF:Navigation', $key) ?: $this->em()->create('XF:Navigation');
            $nav->navigation_id = $key;
            $nav->parent_navigation_id = '';
            $nav->display_order = $key === 'stormHome' ? 1 : 50;
            $nav->enabled = true;
            $nav->navigation_type_id = 'basic';
            $nav->type_config = ['link' => $link, 'display_condition' => '', 'extra_attributes' => []];
            $phrase = $nav->getMasterPhrase();
            $phrase->phrase_text = $title;
            $nav->save();
            $phrase->save();
        }
    }
}
