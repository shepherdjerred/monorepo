<?php
require '/app/forum/src/XF.php';
XF::start('/app/forum');
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, 'Mail fixture failed: ' . get_class($error) . "\n"); exit(1); });
$app = XF::setupApp('XF\Cli\App');
$app->start();
if (!($app->mailer()->getDefaultTransport() instanceof Storm\Forum\Mail\RequiredStartTlsTransport)) { throw new RuntimeException('Required STARTTLS listener was not registered'); }
$transport = new Storm\Forum\Mail\RequiredStartTlsTransport('127.0.0.1', 19002, false);
$transport->setUsername('fixture');
$transport->setPassword('fixture-only');
$email = (new Symfony\Component\Mime\Email())->from('fixture@example.test')->to('receiver@example.test')->text('Local transport fixture');
try {
    $transport->send($email);
    throw new RuntimeException('An insecure SMTP connection was accepted');
} catch (Symfony\Component\Mailer\Exception\TransportException $error) {
    if (!str_contains($error->getMessage(), 'without STARTTLS')) { throw $error; }
}
if (file_exists('/tmp/storm-forum/cleartext-auth-observed')) { throw new RuntimeException('Credentials were sent before STARTTLS'); }
echo "Native mail listener and refusal of cleartext SMTP authentication passed.\n";
