<?php
// Deterministic, local names and robot artwork. No external avatar service.
function sessionName(string $digest): string
{
    $words = json_decode(file_get_contents(__DIR__ . '/identity-words.json'), true, 512, JSON_THROW_ON_ERROR);
    $name = [];
    foreach (['adjectives', 'places', 'animals'] as $index => $kind) {
        $name[] = $words[$kind][hexdec(substr($digest, $index * 4, 4)) % count($words[$kind])];
    }
    return implode(' ', $name);
}

function sessionAbout(array $input, string $runner): string
{
    $context = $input['context'] ?? [];
    $fields = ['Model' => 'model', 'Repository' => 'repository', 'Branch' => 'branch', 'Worktree' => 'worktree', 'Working directory' => 'cwd'];
    $lines = ['[B]Session context[/B]', 'Runner: ' . $runner];
    foreach ($fields as $label => $key) {
        $value = $context[$key] ?? null;
        if ($value !== null && (!is_string($value) || strlen($value) > 4096 || preg_match('/[\r\n\x00]/', $value))) {
            throw new RuntimeException('Invalid profile context');
        }
        $lines[] = $label . ': ' . ($value === null ? 'Not provided' : str_replace(['[', ']'], ['［', '］'], $value));
    }
    $lines[] = 'Session: ' . $input['sessionId'];
    return implode("\n", $lines);
}

function installSessionAvatar($app, $user, string $digest): void
{
    if ($user->avatar_date) { return; }
    $palettes = [[32, 117, 130], [107, 82, 169], [180, 83, 68], [36, 113, 81], [47, 104, 174], [164, 95, 37], [166, 66, 116], [74, 105, 91]];
    $palette = $palettes[hexdec(substr($digest, 12, 2)) % count($palettes)];
    $image = imagecreatetruecolor(512, 512);
    $background = imagecolorallocate($image, ...$palette);
    $ink = imagecolorallocate($image, 27, 38, 53);
    $cream = imagecolorallocate($image, 251, 245, 225);
    $accent = imagecolorallocate($image, 246, 193, 87);
    imagefill($image, 0, 0, $background);
    // Orbit, shoulders, and a small antenna give each workshop bot a silhouette.
    imagesetthickness($image, 5);
    imagearc($image, 256, 256, 428, 428, 205, 345, $cream);
    imagefilledellipse($image, 256, 498, 326, 208, $ink);
    imagefilledellipse($image, 256, 507, 292, 204, $cream);
    $antennaX = 180 + (hexdec(substr($digest, 14, 2)) % 153);
    imagefilledrectangle($image, $antennaX - 6, 99, $antennaX + 6, 154, $ink);
    imagefilledellipse($image, $antennaX, 96, 38, 38, $ink);
    imagefilledellipse($image, $antennaX, 96, 24, 24, $accent);
    imagefilledellipse($image, 122, 270, 46, 93, $ink);
    imagefilledellipse($image, 390, 270, 46, 93, $ink);
    $round = (hexdec(substr($digest, 16, 2)) % 2) === 0;
    if ($round) {
        imagefilledellipse($image, 256, 273, 287, 268, $ink);
        imagefilledellipse($image, 256, 270, 263, 245, $cream);
    } else {
        imagefilledrectangle($image, 128, 144, 384, 397, $ink);
        imagefilledrectangle($image, 140, 156, 372, 385, $cream);
    }
    imagefilledrectangle($image, 161, 214, 351, 299, $ink);
    $eyeStyle = hexdec(substr($digest, 18, 2)) % 3;
    foreach ([208, 304] as $x) {
        if ($eyeStyle === 0) imagefilledellipse($image, $x, 256, 29, 36, $accent);
        elseif ($eyeStyle === 1) imagefilledrectangle($image, $x - 15, 243, $x + 15, 269, $accent);
        else imagearc($image, $x, 265, 33, 33, 190, 350, $accent);
    }
    imagearc($image, 256, 315, 69, 52, 10, 170, $ink);
    imagefilledellipse($image, 164, 327, 20, 13, $background);
    imagefilledellipse($image, 348, 327, 20, 13, $background);
    imagefilledellipse($image, 256, 456, 34, 34, $ink);
    imagefilledellipse($image, 256, 456, 20, 20, $accent);
    $file = tempnam(sys_get_temp_dir(), 'forum-avatar-');
    try {
        if ($file === false || !imagepng($image, $file)) throw new RuntimeException('Avatar rendering failed');
        $avatar = $app->service(\XF\Service\User\AvatarService::class, $user);
        $avatar->logIp(false);
        $avatar->logChange(false);
        if (!$avatar->setImage($file) || !$avatar->updateAvatar()) throw new RuntimeException('Avatar installation failed');
    } finally {
        imagedestroy($image);
        if ($file !== false && file_exists($file)) unlink($file);
    }
}
