<?php
namespace Storm\Forum\Mail;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;

// XenForo 2.3's bundled Symfony transport opportunistically negotiates TLS.
// Keep its authentication and certificate validation, but refuse cleartext.
final class RequiredStartTlsTransport extends EsmtpTransport
{
    private bool $requestedTls = false;
    private bool $secured = false;
    protected function doHeloCommand(): void
    {
        $this->requestedTls = false;
        $this->secured = false;
        parent::doHeloCommand();
        if (!$this->secured) { throw new TransportException('The Storm mail transport requires STARTTLS.'); }
    }
    public function executeCommand(string $command, array $codes): string
    {
        if (str_starts_with($command, 'AUTH ') && !$this->secured) {
            throw new TransportException('Refusing SMTP authentication without STARTTLS.');
        }
        $response = parent::executeCommand($command, $codes);
        if (str_starts_with($command, 'EHLO ') && $this->requestedTls) {
            // EsmtpTransport sends this second EHLO only after startTLS()
            // succeeds with certificate and hostname verification enabled.
            $this->secured = true;
        }
        if ($command === "STARTTLS\r\n") { $this->requestedTls = true; }
        return $response;
    }
}
