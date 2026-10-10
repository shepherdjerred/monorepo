<?php
namespace Storm\Forum\Service;

/** Public-only cache reader shared by the initial page and refresh endpoint. */
final class MinecraftStatus
{
    private const STATES = ['sleeping', 'starting', 'online', 'unavailable'];

    private static function checkKeys(array $value, array $allowed): void
    {
        if (array_diff(array_keys($value), $allowed)) { throw new \RuntimeException('Unknown Minecraft status cache field'); }
    }

    private static function objectFields(mixed $value, array $allowed): array
    {
        if (!$value instanceof \stdClass) { throw new \RuntimeException('Expected Minecraft status cache object'); }
        $fields = get_object_vars($value);
        self::checkKeys($fields, $allowed);
        return $fields;
    }

    private static function isNonnegativeInteger(mixed $value): bool
    {
        return (is_int($value) || (is_float($value) && is_finite($value) && floor($value) === $value))
            && $value >= 0 && $value <= 9007199254740991;
    }

    public static function read(string $path = '/var/lib/storm-forum/status.json', ?int $now = null): array
    {
        $now ??= time();
        $manifest = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $mc = $manifest['minecraft'];
        $result = ['schemaVersion'=>2, 'state'=>'unavailable', 'checkedAt'=>null, 'staleAfterSeconds'=>$mc['staleAfterSeconds'],
            'connections'=>$mc['connections'], 'java'=>['state'=>'unavailable'], 'bedrock'=>['state'=>'unavailable'], 'players'=>null];
        if (!is_file($path)) { return $result; }
        $decoded = json_decode(file_get_contents($path), false, 512, JSON_THROW_ON_ERROR);
        if (!$decoded instanceof \stdClass) { throw new \RuntimeException('Invalid Minecraft status cache'); }
        $data = get_object_vars($decoded);
        // Only the known count-only format is migrated, until the next refresh.
        if (!array_key_exists('schemaVersion', $data)) {
            self::checkKeys($data, ['state', 'checkedAt', 'online', 'maximum']);
            if (!in_array($data['state'] ?? null, self::STATES, true) || !self::isNonnegativeInteger($data['checkedAt'] ?? null)) {
                throw new \RuntimeException('Invalid legacy Minecraft status cache');
            }
            foreach (['online', 'maximum'] as $field) {
                if (array_key_exists($field, $data) && !self::isNonnegativeInteger($data[$field])) { throw new \RuntimeException('Invalid legacy Minecraft player count'); }
            }
            return $result;
        }
        self::checkKeys($data, ['schemaVersion', 'state', 'checkedAt', 'java', 'bedrock', 'players']);
        if (!in_array($data['schemaVersion'] ?? null, [2, 2.0], true) || !in_array($data['state'] ?? null, self::STATES, true)
            || !self::isNonnegativeInteger($data['checkedAt'] ?? null)) { throw new \RuntimeException('Invalid Minecraft status cache'); }
        $fresh = $data['checkedAt'] <= $now + 5 && $now - $data['checkedAt'] < $mc['staleAfterSeconds'];
        $result['checkedAt'] = (int)$data['checkedAt'];
        $result['state'] = $fresh ? $data['state'] : 'unavailable';
        foreach (['java', 'bedrock'] as $edition) {
            $value = self::objectFields($data[$edition] ?? null, ['state', 'version', 'verifiedAt']);
            if (!in_array($value['state'] ?? null, self::STATES, true)) { throw new \RuntimeException('Invalid Minecraft edition status'); }
            $data[$edition] = $value;
            $result[$edition]['state'] = $fresh ? $value['state'] : 'unavailable';
            $hasVersion = array_key_exists('version', $value);
            $hasVerifiedAt = array_key_exists('verifiedAt', $value);
            if ($hasVersion !== $hasVerifiedAt || ($value['state'] === 'online' && !$hasVersion)) {
                throw new \RuntimeException('Minecraft edition is missing its verified version');
            }
            if ($hasVersion) {
                if (!is_string($value['version']) || $value['version'] === '' || mb_strlen($value['version'], 'UTF-8') > 100
                    || !self::isNonnegativeInteger($value['verifiedAt'] ?? null)) { throw new \RuntimeException('Invalid Minecraft version'); }
                $result[$edition]['version'] = $value['version'];
                $result[$edition]['verifiedAt'] = (int)$value['verifiedAt'];
            }
        }
        $hasPlayers = array_key_exists('players', $data);
        if ($hasPlayers) {
            $players = self::objectFields($data['players'], ['maximum', 'names']);
            if (!self::isNonnegativeInteger($players['maximum'] ?? null) || $players['maximum'] > 100000
                || !is_array($players['names'] ?? null) || !array_is_list($players['names']) || count($players['names']) > $players['maximum']) { throw new \RuntimeException('Invalid Minecraft player roster'); }
            foreach ($players['names'] as $name) {
                if (!is_string($name) || !preg_match('/^[^\p{Cc}<>]{1,64}$/uD', $name)) { throw new \RuntimeException('Invalid Minecraft player name'); }
            }
            if (count(array_unique($players['names'], SORT_STRING)) !== count($players['names'])) { throw new \RuntimeException('Duplicate Minecraft player names'); }
            if ($data['java']['state'] !== 'online') { throw new \RuntimeException('Player roster requires a successful Query check'); }
            if ($fresh) { $result['players'] = ['maximum'=>(int)$players['maximum'], 'names'=>$players['names']]; }
        }
        if ($data['java']['state'] === 'online' && !$hasPlayers) { throw new \RuntimeException('Online Query response is missing its roster'); }
        return $result;
    }
}
