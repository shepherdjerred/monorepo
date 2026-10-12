<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void {
    fwrite(STDERR, 'Portal fixture failed: ' . get_class($error) . ' at ' . basename($error->getFile()) . ':' . $error->getLine() . "\n");
    foreach ($error->getTrace() as $frame) { fwrite(STDERR, ($frame['class'] ?? '') . '::' . ($frame['function'] ?? '') . ':' . ($frame['line'] ?? 0) . "\n"); }
    exit(1);
});
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['REQUEST_METHOD'] = 'GET';
$app = XF::setupApp('XF\Pub\App');
$app->start();
$map = $app->registry()->get('stormForumMap');
$original = $map;
// Exercise the node guard against a genuinely private, populated native forum.
$map['node:news'] = $map['node:reports'];
$app->registry()->set('stormForumMap', $map);
try {
    $controller = $app->controller('Storm\Forum:Portal', $app->request());
    $guest = $app->repository('XF:User')->getGuestUser();
    $staff = $app->em()->find('XF:User', 1);
    foreach ([[$guest, 0], [$staff, 1]] as [$visitor, $expected]) {
        $news = XF::asVisitor($visitor, fn() => $controller->actionIndex()->getParam('news'));
        if (count($news) !== $expected) { throw new RuntimeException('Portal node visibility differs'); }
    }
} finally {
    $app->registry()->set('stormForumMap', $original);
}
echo "Native portal node permissions hide private news from guests.\n";
