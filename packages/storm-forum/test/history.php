<?php
require __DIR__ . '/fixtures/history-source.php';
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, (string)$error . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App'); $app->start();
$check = static function (bool $condition, string $message): void { if (!$condition) { throw new RuntimeException($message); } };
$console = require '/opt/storm-forum/runtime/console.php';
$run = static function (array $options = []) use ($console): void {
    $input = new Symfony\Component\Console\Input\ArrayInput($options); $input->setInteractive(false);
    $check = $console->find('storm:history')->run($input, new Symfony\Component\Console\Output\NullOutput());
    if ($check !== 0) { throw new RuntimeException('History import failed'); }
    stormConsoleCleanup();
};
$users = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user');
$corpus = json_decode(file_get_contents('/opt/storm-forum/config/history.json'), true, 512, JSON_THROW_ON_ERROR);
$historyKey = static fn(array $record, ?int $id = null) => (($record['era'] ?? 'original') === 'original' ? '' : $record['era'] . ':') . ($id ?? $record['originalId']);
$baseline = $corpus;
$addedAnnouncements = [22,35,76,91,331,353,432,454,607];
$addedReplies = [2057,3859,3977,4007,4137];
$baseline['threads'] = array_values(array_filter($baseline['threads'], fn($record) => !isset($record['era']) && !in_array($record['originalId'], $addedAnnouncements, true)));
$baseline['users'] = array_values(array_filter($baseline['users'], fn($record) => !isset($record['era']) && !in_array($record['originalId'], [5,7,9,13], true)));
foreach ($baseline['threads'] as &$record) {
    unset($record['poll']);
    $record['posts'] = array_values(array_filter($record['posts'], fn($post) => !in_array($post['originalPostId'], $addedReplies, true)));
    foreach ($record['posts'] as &$post) { unset($post['ratings']); } unset($post);
    if (in_array($record['node'], ['chaos','voting','towns','lysergia','boomerville','keystone'], true)) { $record['node'] = 'general'; }
}
unset($record);
$GLOBALS['stormFixtureHistory'] = $baseline;
$run();
$baselineMap = $app->registry()->get('stormForumHistory');
$baselinePostCount = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_post');
unset($GLOBALS['stormFixtureHistory']);
try {
    $rejected = false;
    try { $run(); } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'explicit migration'); }
    $check($rejected, 'Additional captured content was imported without explicit migration');
    $run(['--migrate'=>true, '--dry-run'=>true]);
    $check($app->db()->fetchOne('SELECT COUNT(*) FROM xf_post') == $baselinePostCount, 'Recovery dry run changed native posts');
    $run(['--migrate'=>true]);
    $expandedMap = $app->registry()->get('stormForumHistory');
    $check($app->db()->fetchOne('SELECT COUNT(*) FROM xf_post') == $baselinePostCount + 16, 'Recovered announcements/image-only replies and revival posts were not imported exactly once');
    foreach ($baselineMap as $id=>$entry) {
        $check($expandedMap[$id]['threadId'] === $entry['threadId'], 'Recovery changed an existing thread ID');
        foreach ($entry['posts'] as $key=>$native) { $check($expandedMap[$id]['posts'][$key] === $native, 'Recovery changed an existing post ID'); }
    }
    $run();
    $check($expandedMap === $app->registry()->get('stormForumHistory'), 'Recovery repeat import changed stable checkpoints');
} finally { unset($GLOBALS['stormFixtureHistory']); }
$map = $app->registry()->get('stormForumHistory');
$check(count($map) === 131, 'Restored thread count differs from reviewed corpus');
$identities = $app->registry()->get('stormForumHistoricalUsers');
$check(count($identities) === 79, 'Historical aliases were not scoped by era/member ID');
$check($identities['revival2016:1']['userId'] === $identities[1]['userId'] && $identities['revival2022:1']['userId'] === $identities[1]['userId'], 'Explicit owner mapping duplicated the owner across eras');
$check(isset($map['revival2022:1']) && !isset($map[1]), 'A revival thread ID leaked into original-era redirect mappings');
$check(count($app->registry()->get('stormHistoryRatings')) === 248 && count($app->registry()->get('stormHistoryPolls')) === 8, 'Captured historical totals missing');
$check($app->db()->fetchOne('SELECT COUNT(*) FROM xf_reaction_content') == 0 && $app->db()->fetchOne('SELECT COUNT(*) FROM xf_poll_vote') == 0, 'Snapshot totals created fictional native voters');
$afterUsers = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user');
$run();
$check($afterUsers == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user'), 'Repeat history import created duplicate profiles');
$threads = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread');
try {
    // Simulate another process committing after this process cached an empty import map.
    $app->registry()->set('stormForumHistory', []);
    (new XF\DataRegistry($app->db()))->set('stormForumHistory', $map);
    $run();
    $check($threads == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_thread'), 'Stale registry cache duplicated a completed import');
} finally { $app->registry()->set('stormForumHistory', $map); }
$corpus = json_decode(file_get_contents('/opt/storm-forum/config/history.json'), true, 512, JSON_THROW_ON_ERROR);
$guest = $app->repository('XF:User')->getGuestUser();
$member = $app->finder('XF:User')->where('username', 'LocalAuthor')->fetchOne();
// A corpus migration applies thread metadata before advancing its record hash.
$record = $corpus['threads'][array_search(42, array_column($corpus['threads'], 'originalId'))];
$nodes = $app->registry()->get('stormForumMap');
try {
    $thread = $app->em()->find('XF:Thread', $map[42]['threadId'], ['Forum']);
    $thread->setOption('log_moderator', false);
    $thread->bulkSet(['title'=>'Previous archive title', 'node_id'=>$nodes['node:' . ($record['node'] === 'games' ? 'general' : 'games')]]); $thread->save();
    $changed = $map; $changed[42]['hash'] = str_repeat('0', 64); $changed[42]['slug'] = 'previous-archive-slug';
    $app->registry()->set('stormForumHistory', $changed); $run(['--migrate'=>true]);
    $thread = $app->em()->find('XF:Thread', $map[42]['threadId']);
    $check($thread->title === $record['title'] && $thread->node_id === $nodes['node:' . $record['node']], 'Reviewed thread title/forum were not applied before checkpointing');
    $checkpoint = $app->registry()->get('stormForumHistory')[42];
    $check($checkpoint['slug'] === $record['slug'] && $checkpoint['posts'] === $map[42]['posts'], 'Reviewed slug or native post IDs changed incorrectly');
    $run();
    $check($app->registry()->get('stormForumHistory')[42] === $checkpoint, 'Repeat metadata migration changed the checkpoint');
} finally {
    $thread = $app->em()->find('XF:Thread', $map[42]['threadId'], ['Forum']);
    $thread->setOption('log_moderator', false);
    $thread->bulkSet(['title'=>$record['title'], 'node_id'=>$nodes['node:' . $record['node']]]); $thread->save();
    $app->registry()->set('stormForumHistory', $map); $app->em()->clearEntityCache();
}
// Native member renames keep native display behavior; imported aliases keep their archived label.
$templater = $app->templater();
$displayName = static function (string $html): string {
    if (!preg_match('#<h4 class="message-name">(.*?)</h4>#s', $html, $match)) { throw new RuntimeException('Native author macro did not render its name'); }
    return html_entity_decode(trim(strip_tags($match[1])), ENT_QUOTES);
};
$originalName = $member->username;
try {
    $member->setOption('admin_edit', true); $member->username = 'LocalAuthorRenamed'; $member->save();
    $html = $templater->renderMacro('public:message_macros', 'user_info', ['user'=>$member, 'fallbackName'=>$originalName]);
    $check($displayName($html) === 'LocalAuthorRenamed', 'Ordinary posts use a stale stored name after a member rename: ' . $displayName($html));
    $historical = $app->em()->find('XF:User', reset($identities)['userId']);
    $html = $templater->renderMacro('public:message_macros', 'user_info', ['user'=>$historical, 'fallbackName'=>'ArchivedAliasAcceptance']);
    $check($displayName($html) === 'ArchivedAliasAcceptance', 'Historical post alias was replaced by the canonical profile name: ' . $displayName($html));
    $html = $templater->renderMacro('public:message_macros', 'user_info', ['user'=>null, 'fallbackName'=>'GuestAcceptance']);
    $check($displayName($html) === 'GuestAcceptance', 'Guest/deleted-user posts lost their native fallback label');
} finally { $member->username = $originalName; $member->save(); }
// Previously imported identity/media checkpoints must reject unsupported corpus changes before writes.
$profileHash = new ReflectionMethod(Storm\Forum\Cli\Command\History::class, 'profileHash');
$recordHash = new ReflectionMethod(Storm\Forum\Cli\Command\History::class, 'hash');
$identity = array_values(array_filter($corpus['users'], static fn($item) => $item['avatar'] !== null))[0];
$asset = $corpus['attachments'][0];
$owner = null; $assetPost = null;
foreach ($map as $id=>$entry) { foreach ($entry['attachments'] ?? [] as $key=>$attachments) { if (isset($attachments[$asset['originalId']])) { $owner = $id; $assetPost = $key; break 2; } } }
$check($owner !== null && $assetPost !== null, 'Recovered media revision fixture has no native owner');
$duplicate = $corpus;
foreach ($duplicate['threads'] as $threadIndex=>$discussion) {
    foreach ($discussion['posts'] as $postIndex=>$post) {
        if ($post['key'] !== $assetPost) { $duplicate['threads'][$threadIndex]['posts'][$postIndex]['attachments'][] = $asset['originalId']; break 2; }
    }
}
try {
    $GLOBALS['stormFixtureHistory'] = $duplicate;
    $nativeUsers = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user');
    $nativeMedia = $app->db()->fetchAll('SELECT attachment_id, data_id, content_type, content_id FROM xf_attachment ORDER BY attachment_id');
    foreach ([['--migrate'=>true], ['--migrate'=>true, '--dry-run'=>true]] as $options) {
        $rejected = false;
        try { $run($options); } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'Duplicate historical attachment ownership'); }
        $check($rejected, 'Duplicate attachment ownership was not rejected by native command preflight');
        $check($nativeMedia === $app->db()->fetchAll('SELECT attachment_id, data_id, content_type, content_id FROM xf_attachment ORDER BY attachment_id') && $nativeUsers == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user'), 'Duplicate ownership preflight persisted profiles or media');
        $check((new XF\DataRegistry($app->db()))->get('stormForumHistory') === $map && (new XF\DataRegistry($app->db()))->get('stormForumHistoricalUsers') === $identities, 'Duplicate ownership preflight advanced a registry checkpoint');
    }
} finally { unset($GLOBALS['stormFixtureHistory']); }
$revisions = [];
foreach (['username'=>'PreviousCanonicalName', 'aliases'=>['PreviousAlias'], 'slugs'=>['previous-slug'], 'avatar'=>null] as $field=>$value) {
    $prior = $identity; $prior[$field] = $value;
    $priorUsers = $identities; $priorUsers[$identity['originalId']]['metadataHash'] = $profileHash->invoke(null, $prior);
    $revisions[] = [$map, $priorUsers, 'Imported profile metadata changed'];
}
foreach (['filename'=>'previous-filename.png', 'sha256'=>str_repeat('0', 64)] as $field=>$value) {
    $prior = $asset; $prior[$field] = $value;
    $priorMap = $map; $priorMap[$owner]['attachmentHashes'][$asset['originalId']] = $recordHash->invoke(null, $prior);
    $revisions[] = [$priorMap, $identities, 'Imported attachment membership or metadata changed'];
}
$priorMap = $map; $priorMap[$owner]['attachments'][$assetPost][99999999] = $map[$owner]['attachments'][$assetPost][$asset['originalId']];
$revisions[] = [$priorMap, $identities, 'Imported attachment membership or metadata changed'];
$nativeBefore = $app->db()->fetchAll('SELECT user_id, username, avatar_date, message_count FROM xf_user ORDER BY user_id');
$mediaBefore = $app->db()->fetchAll('SELECT attachment_id, data_id, content_type, content_id, unassociated FROM xf_attachment ORDER BY attachment_id');
foreach ($revisions as [$priorMap, $priorUsers, $reason]) {
    try {
        $app->registry()->set('stormForumHistory', $priorMap); $app->registry()->set('stormForumHistoricalUsers', $priorUsers);
        foreach ([['--migrate'=>true], ['--migrate'=>true, '--dry-run'=>true]] as $options) {
            $rejected = false;
            try { $run($options); } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), $reason); }
            $check($rejected, 'Unsupported identity or media revision silently advanced its checkpoint');
            $check((new XF\DataRegistry($app->db()))->get('stormForumHistory') === $priorMap && (new XF\DataRegistry($app->db()))->get('stormForumHistoricalUsers') === $priorUsers, 'Rejected identity/media revision changed an import registry');
            $check($nativeBefore === $app->db()->fetchAll('SELECT user_id, username, avatar_date, message_count FROM xf_user ORDER BY user_id'), 'Rejected revision changed native profiles');
            $check($mediaBefore === $app->db()->fetchAll('SELECT attachment_id, data_id, content_type, content_id, unassociated FROM xf_attachment ORDER BY attachment_id'), 'Rejected revision changed native media ownership');
        }
    } finally { $app->registry()->set('stormForumHistory', $map); $app->registry()->set('stormForumHistoricalUsers', $identities); }
}
// Reproduce an actual v1 guest import: unchanged messages upgrade, while staff edits survive.
$legacy = json_decode(file_get_contents('/opt/storm-forum/test/fixtures/legacy-posts.json'), true, 512, JSON_THROW_ON_ERROR);
$saved = [];
try {
    $oldMap = $map; $oldMap[42]['version'] = 1;
    foreach ($legacy as $index=>$item) {
        unset($oldMap[42]['messageHashes'][$item['key']]);
        $post = $app->em()->find('XF:Post', $map[42]['posts'][$item['key']]);
        $saved[$post->post_id] = ['message'=>$post->message, 'user_id'=>$post->user_id];
        $post->user_id = 0; $post->message = $item['message'] . ($index ? "\nStaff edit before migration." : ''); $post->save();
    }
    $app->registry()->set('stormForumHistory', $oldMap); $run();
    foreach ($legacy as $index=>$item) {
        $post = $app->em()->find('XF:Post', $map[42]['posts'][$item['key']]);
        $check($post->user_id === $identities[$corpus['threads'][array_search(42, array_column($corpus['threads'], 'originalId'))]['posts'][$index]['originalUserId']]['userId'], 'v1 guest post was not assigned its native profile');
        $expected = $index ? $item['message'] . "\nStaff edit before migration." : $saved[$post->post_id]['message'];
        $check($post->message === $expected, 'Migration lost recovered formatting or overwrote a staff edit');
    }
    $check(count($app->registry()->get('stormForumHistory')[42]['conflicts'] ?? []) === 1, 'Migration did not report the edited message');
    // Ordinary release refuses unknown revisions; explicit migration retains native IDs.
    $changed = $app->registry()->get('stormForumHistory'); $changed[42]['hash'] = str_repeat('0', 64);
    $app->registry()->set('stormForumHistory', $changed);
    $rejected = false;
    try { $run(); } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'explicit migration'); }
    $check($rejected, 'Unreviewed corpus revision was silently applied');
    $run(['--migrate'=>true]);
    $check($app->registry()->get('stormForumHistory')[42]['posts'] === $map[42]['posts'], 'Explicit migration changed native post IDs');
} finally {
    foreach ($saved as $id=>$values) { $post = $app->em()->find('XF:Post', $id); $post->bulkSet($values); $post->save(); }
    $app->registry()->set('stormForumHistory', $map);
    $app->em()->clearEntityCache();
}
foreach ($corpus['users'] as $item) {
    $user = $app->em()->find('XF:User', $identities[$historyKey($item)]['userId'], ['Auth','Privacy']);
    $check($user->username === $item['username'] && $user->email === '', 'Historical identity was fabricated or merged by name');
    $check(!$user->Auth->authenticate('invalid-test-password') && !$user->Auth->getAuthenticationHandler()->hasPassword(), 'Historical profile can authenticate');
    $check(!$user->is_staff && !$user->is_admin && !$user->is_moderator && $user->last_activity === 0, 'Historical profile has restored staff privileges or fake activity');
    $check(XF::asVisitor($guest, fn() => $user->canViewFullProfile()), 'Historical profile is not publicly visible');
    $expectedCount = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_post p JOIN xf_thread t ON t.thread_id = p.thread_id JOIN xf_forum f ON f.node_id = t.node_id WHERE p.user_id = ? AND p.message_state = ? AND t.discussion_state = ? AND f.count_messages = 1', [$user->user_id, 'visible', 'visible']);
    $check($user->message_count == $expectedCount, 'Historical profile native post count differs, including empty recovered profiles');
    if ($item['avatar']) { $check($user->avatar_date > 0, 'Recovered avatar missing'); }
}
$attachmentLinks = [];
foreach ($map as $entry) { foreach ($entry['attachments'] ?? [] as $attachments) { foreach ($attachments as $original=>$native) { $attachmentLinks[$original] = $native; } } }
$memberLinks = 0; $crossPostLinks = 0;
foreach ($corpus['threads'] as $record) {
    $recordKey = $historyKey($record);
    $thread = $app->em()->find('XF:Thread', $map[$recordKey]['threadId']);
    $check($thread->discussion_open && $thread->user_id === $identities[$historyKey($record, $record['posts'][0]['originalUserId'])]['userId'], 'Restored discussion has incorrect native ownership');
    $check($thread->first_post_id === $map[$recordKey]['posts'][$record['posts'][0]['key']], 'Recovered original first post did not become the native first post');
    $check(XF::asVisitor($guest, fn() => $thread->canView()), 'Restored public discussion is not guest-visible');
    $check(XF::asVisitor($member, fn() => $thread->canReply()), 'Members cannot reply to a restored discussion');
    $check($thread->reply_count === count($record['posts']) - 1, 'Historical reply count is incorrect');
    foreach ($record['posts'] as $position=>$item) {
        $post = $app->em()->find('XF:Post', $map[$recordKey]['posts'][$item['key']]);
        $check($post->user_id === $identities[$historyKey($record, $item['originalUserId'])]['userId'] && $post->username === $item['author'] && $post->post_date === $item['date'], 'Original attribution/date changed');
        $check($post->position === $position, 'Historical post ordering changed');
        preg_match_all('#\[URL=https?://ts-mc\.net(?::80)?/(members|attachments)/(?:[^/\]]+\.)?(\d+)(?:/[^\]]*)?\]#i', $item['message'], $links, PREG_SET_ORDER);
        foreach ($links as $link) {
            $id = (int)$link[2];
            if ($link[1] === 'members' && isset($identities[$id])) {
                $url = $app->router('public')->buildLink('canonical:members', $app->em()->find('XF:User', $identities[$id]['userId']));
                $check(str_contains($post->message, '[URL=' . $url . ']'), 'Historical numeric/slug member link points at an old native ID');
                $memberLinks++;
            } elseif ($link[1] === 'attachments' && isset($attachmentLinks[$id])) {
                $url = $app->router('public')->buildLink('canonical:attachments', $app->em()->find('XF:Attachment', $attachmentLinks[$id]));
                $check(str_contains($post->message, '[URL=' . $url . ']'), 'Historical cross-post attachment link points at an old native ID');
                if (!in_array($id, $item['attachments'], true)) { $crossPostLinks++; }
            }
        }
        foreach ($item['attachments'] as $original) {
            $native = $map[$recordKey]['attachments'][$item['key']][$original];
            $attachment = $app->em()->find('XF:Attachment', $native, ['Data']);
            $check($attachment->content_type === 'post' && $attachment->content_id === $post->post_id && !$attachment->unassociated, 'Recovered attachment has no native post association');
            $check($attachment->Data->width > 0 && $attachment->Data->thumbnail_width > 0, 'Recovered attachment image/thumbnail missing');
            $check(XF::asVisitor($guest, fn() => $attachment->canView()), 'Recovered public attachment is not guest-visible');
        }
    }
}
$check($memberLinks > 0 && $crossPostLinks > 0, 'Corpus link regressions did not exercise numeric members and cross-post attachments');
$reactionPost = $app->em()->find('XF:Post', $map[42]['posts'][$corpus['threads'][array_search(42, array_column($corpus['threads'], 'originalId'))]['posts'][0]['key']]);
$reactor = $app->finder('XF:User')->where('username', 'LocalOther')->fetchOne();
$reactionRepository = $app->repository('XF:Reaction');
foreach (['like','agree','disagree','funny','winner','informative','useful','optimistic','friendly','creative'] as $type) {
    $reactionId = $nodes['reaction:' . $type];
    $reactionRepository->reactToContent($reactionId, 'post', $reactionPost->post_id, $reactor, false);
    $app->em()->clearEntityCache();
    $freshPost = $app->em()->find('XF:Post', $reactionPost->post_id);
    $check(array_sum($freshPost->reactions) === 1 && $freshPost->reaction_score === ($type === 'disagree' ? 0 : 1), 'Native reaction count/score differs for ' . $type);
    $reactionRepository->reactToContent($reactionId, 'post', $reactionPost->post_id, $reactor, false);
    $app->em()->clearEntityCache();
}
$check($app->db()->fetchOne('SELECT COUNT(*) FROM xf_reaction_content') == 0, 'Native reaction fixture did not remove its votes');
$before = $app->db()->fetchOne('SELECT COUNT(*) FROM xf_post');
$thread = $app->em()->find('XF:Thread', $map[42]['threadId'], ['FirstPost']);
$original = $thread->FirstPost->message;
$reply = null;
try {
    $thread->FirstPost->message = $original . "\nLocal staff edit acceptance."; $thread->FirstPost->save();
    $reply = XF::asVisitor($member, function () use ($app, $thread) {
        $creator = $app->service('XF:Thread\Replier', $thread);
        $creator->setMessage('Local reply acceptance.'); $creator->setIsAutomated();
        return $creator->save();
    });
    // A later reply remains native; an omitted previously mapped post/thread must reject the revision.
    $omittedPost = $map;
    $omittedPost[42]['posts']['t42:p99999999'] = $reply->post_id;
    $omittedPost[42]['messageHashes']['t42:p99999999'] = hash('sha256', $reply->message);
    $omittedPost[42]['hash'] = str_repeat('0', 64);
    $omittedThread = $map; $omittedThread[99999999] = $map[42];
    $nativeBefore = $app->db()->fetchAll('SELECT post_id, user_id, username, post_date, message, message_state FROM xf_post WHERE thread_id = ? ORDER BY post_id', $thread->thread_id);
    foreach ([$omittedPost, $omittedThread] as $revisionMap) {
        try {
            $app->registry()->set('stormForumHistory', $revisionMap);
            foreach ([['--migrate'=>true], ['--migrate'=>true, '--dry-run'=>true]] as $options) {
                $rejected = false;
                try { $run($options); } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'removes mapped historical posts'); }
                $check($rejected, 'A corpus revision dropping an imported post or discussion was accepted');
                $check((new XF\DataRegistry($app->db()))->get('stormForumHistory') === $revisionMap, 'Rejected revision changed the import checkpoint');
                $check($nativeBefore === $app->db()->fetchAll('SELECT post_id, user_id, username, post_date, message, message_state FROM xf_post WHERE thread_id = ? ORDER BY post_id', $thread->thread_id), 'Rejected revision changed imported content, staff edits, or a later reply');
                $check($afterUsers == $app->db()->fetchOne('SELECT COUNT(*) FROM xf_user'), 'Rejected revision changed historical profiles');
            }
        } finally { $app->registry()->set('stormForumHistory', $map); }
    }
    $run();
    $check($app->db()->fetchOne('SELECT COUNT(*) FROM xf_post') == $before + 1, 'Repeat import duplicated posts or removed a new reply');
    $check($app->db()->fetchOne('SELECT message FROM xf_post WHERE post_id = ?', $thread->first_post_id) === $original . "\nLocal staff edit acceptance.", 'Repeat import overwrote a staff edit');
} finally {
    if ($reply) { $reply->delete(); }
    $post = $app->em()->find('XF:Post', $thread->first_post_id); $post->message = $original; $post->save();
}
echo "79 era-scoped identities, 77 native profiles, 17 checkpointed avatars, 131 public discussions, 1,164 posts, eight captured polls, 248 ratings summaries, ten native reactions, migration/removal guards, replies, and edit preservation passed.\n";
