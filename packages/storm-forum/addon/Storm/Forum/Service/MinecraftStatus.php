<?php
namespace Storm\Forum\Service;

/** Public-only cache reader shared by the initial page and refresh endpoint. */
final class MinecraftStatus
{
    private const STATES = ['sleeping', 'starting', 'online', 'unavailable'];

    public static function read(string $path = '/var/lib/storm-forum/status.json', ?int $now = null): array
    {
        $now ??= time();
        $manifest = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $mc = $manifest['minecraft'];
        $result = ['schemaVersion'=>2, 'state'=>'unavailable', 'checkedAt'=>null, 'staleAfterSeconds'=>$mc['staleAfterSeconds'],
            'connections'=>$mc['connections'], 'java'=>['state'=>'unavailable'], 'bedrock'=>['state'=>'unavailable'], 'players'=>null];
        if (!is_file($path)) { return $result; }
        $data = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($data)) { throw new \RuntimeException('Invalid Minecraft status cache'); }
        // Only the known count-only format is migrated, until the next refresh.
        if (!isset($data['schemaVersion']) && in_array($data['state'] ?? null, self::STATES, true) && is_int($data['checkedAt'] ?? null)) { return $result; }
        if (($data['schemaVersion'] ?? null) !== 2 || !in_array($data['state'] ?? null, self::STATES, true)
            || !is_int($data['checkedAt'] ?? null) || $data['checkedAt'] < 0) { throw new \RuntimeException('Invalid Minecraft status cache'); }
        $fresh = $data['checkedAt'] <= $now + 5 && $now - $data['checkedAt'] <= $mc['staleAfterSeconds'];
        $result['checkedAt'] = $data['checkedAt'];
        $result['state'] = $fresh ? $data['state'] : 'unavailable';
        foreach (['java', 'bedrock'] as $edition) {
            $value = $data[$edition] ?? null;
            if (!is_array($value) || !in_array($value['state'] ?? null, self::STATES, true)) { throw new \RuntimeException('Invalid Minecraft edition status'); }
            $result[$edition]['state'] = $fresh ? $value['state'] : 'unavailable';
            if (isset($value['version'])) {
                if (!is_string($value['version']) || $value['version'] === '' || strlen($value['version']) > 100
                    || !is_int($value['verifiedAt'] ?? null) || $value['verifiedAt'] < 0) { throw new \RuntimeException('Invalid Minecraft version'); }
                $result[$edition]['version'] = $value['version'];
                $result[$edition]['verifiedAt'] = $value['verifiedAt'];
            }
        }
        if (isset($data['players'])) {
            $players = $data['players'];
            if (!is_array($players) || !is_int($players['maximum'] ?? null) || $players['maximum'] < 0 || $players['maximum'] > 100000
                || !is_array($players['names'] ?? null) || !array_is_list($players['names']) || count($players['names']) > $players['maximum']
                || count(array_unique($players['names'], SORT_REGULAR)) !== count($players['names'])) { throw new \RuntimeException('Invalid Minecraft player roster'); }
            foreach ($players['names'] as $name) {
                if (!is_string($name) || !preg_match('/^[^\p{Cc}<>]{1,64}$/uD', $name)) { throw new \RuntimeException('Invalid Minecraft player name'); }
            }
            if ($data['java']['state'] !== 'online') { throw new \RuntimeException('Player roster requires a successful Query check'); }
            if ($fresh) { $result['players'] = ['maximum'=>$players['maximum'], 'names'=>$players['names']]; }
        }
        if ($data['java']['state'] === 'online' && !isset($data['players'])) { throw new \RuntimeException('Online Query response is missing its roster'); }
        return $result;
    }
}
