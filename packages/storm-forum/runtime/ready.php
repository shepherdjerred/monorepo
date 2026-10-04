<?php
try {
    if (file_exists('/var/lib/storm-forum/.maintenance')) { throw new RuntimeException('Maintenance active'); }
    foreach (['POSTAL_SMTP_USERNAME', 'POSTAL_SMTP_PASSWORD', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as $key) {
        if (!getenv($key)) { throw new RuntimeException('Runtime credentials unavailable'); }
    }
    require '/app/forum/src/XF.php';
    XF::start('/app/forum');
    $app = XF::setupApp('XF\Pub\App');
    if (!$app->registry()->get('stormForumConfigured')) { throw new RuntimeException('Release configuration incomplete'); }
    if (!$app->db()->fetchOne('SELECT 1')) { throw new RuntimeException('Database unavailable'); }
    $templates = $app->db()->fetchOne("SELECT COUNT(*) FROM xf_template_map WHERE style_id = ? AND type = 'public' AND title IN ('PAGE_CONTAINER', 'storm_portal')", $app->options()->defaultStyleId);
    if ($templates != 2) { throw new RuntimeException('Required templates are not rebuilt'); }
    echo 'ready';
} catch (Throwable $e) {
    // Never put database connection errors (which can include credentials) in a probe response.
    http_response_code(503);
    echo 'not ready';
}
