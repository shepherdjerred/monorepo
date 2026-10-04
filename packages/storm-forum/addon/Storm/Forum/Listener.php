<?php
namespace Storm\Forum;

final class Listener
{
    public static function mailTransport(\XF\Container $container, ?\Symfony\Component\Mailer\Transport\TransportInterface &$transport): void
    {
        $settings = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $transport = new \Storm\Forum\Mail\RequiredStartTlsTransport($settings['smtpHost'], $settings['smtpPort'], false);
        $transport->setUsername(self::credential('POSTAL_SMTP_USERNAME'));
        $transport->setPassword(self::credential('POSTAL_SMTP_PASSWORD'));
    }

    public static function appSetup(\XF\App $app): void
    {
        $settings = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $options = $app->options();
        $options->emailTransport = [
            'emailTransport' => 'smtp',
            'smtpHost' => $settings['smtpHost'],
            'smtpPort' => $settings['smtpPort'],
            'smtpSsl' => false,
            'smtpLoginUsername' => self::credential('POSTAL_SMTP_USERNAME'),
            'smtpLoginPassword' => self::credential('POSTAL_SMTP_PASSWORD'),
        ];
        $options->extraCaptchaKeys = array_replace($options->extraCaptchaKeys, [
            'turnstileSiteKey' => self::credential('TURNSTILE_SITE_KEY'),
            'turnstileSecretKey' => self::credential('TURNSTILE_SECRET_KEY'),
        ]);
        // The native implementation otherwise treats missing keys as a valid CAPTCHA.
        // This listener throws before processing registrations when credentials are absent.
    }

    private static function credential(string $name): string
    {
        $value = getenv($name);
        if ($value === false || $value === '') {
            throw new \RuntimeException("Missing runtime credential: {$name}");
        }
        return $value;
    }
}
