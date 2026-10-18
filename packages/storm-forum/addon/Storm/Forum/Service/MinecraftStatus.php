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

    private static function stateCombinations(): array
    {
        $values = json_decode(file_get_contents('/opt/storm-forum/config/minecraft-status-states.json'), false, 512, JSON_THROW_ON_ERROR);
        if (!is_array($values) || !array_is_list($values) || !$values) { throw new \RuntimeException('Invalid Minecraft state contract'); }
        foreach ($values as $row) {
            if (!is_array($row) || !array_is_list($row) || count($row) !== 3) { throw new \RuntimeException('Invalid Minecraft state combination'); }
            foreach ($row as $state) {
                if (!in_array($state, self::STATES, true)) { throw new \RuntimeException('Unknown Minecraft contract state'); }
            }
        }
        return $values;
    }

    public static function read(string $path = '/var/lib/storm-forum/status.json', ?int $now = null): array
    {
        $now ??= time();
        $manifest = (require '/opt/storm-forum/runtime/manifest.php')();
        $mc = $manifest['minecraft'];
        $stateCombinations = self::stateCombinations();
        $result = ['schemaVersion'=>3, 'state'=>'unavailable', 'checkedAt'=>null, 'staleAfterSeconds'=>$mc['staleAfterSeconds'],
            'connections'=>$mc['connections'], 'java'=>['state'=>'unavailable'], 'bedrock'=>['state'=>'unavailable'], 'players'=>null, 'games'=>null];
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
        $cacheVersion = $data['schemaVersion'] ?? null;
        self::checkKeys($data, $cacheVersion === 2 || $cacheVersion === 2.0
            ? ['schemaVersion', 'state', 'checkedAt', 'java', 'bedrock', 'players']
            : ['schemaVersion', 'state', 'checkedAt', 'java', 'bedrock', 'players', 'games']);
        if (!in_array($cacheVersion, [2, 2.0, 3, 3.0], true) || !in_array($data['state'] ?? null, self::STATES, true)
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
        if (!in_array([$data['state'], $data['java']['state'], $data['bedrock']['state']], $stateCombinations, true)) {
            throw new \RuntimeException('Minecraft aggregate state does not match edition health');
        }
        if ($cacheVersion === 2 || $cacheVersion === 2.0) {
            // Name-only caches cannot render real skin heads or identify players in games.
            $hasPlayers = array_key_exists('players', $data);
            if (($data['java']['state'] === 'online') !== $hasPlayers) {
                throw new \RuntimeException('Legacy Minecraft roster does not match Java health');
            }
            if ($hasPlayers) {
                $oldPlayers = self::objectFields($data['players'] ?? null, ['maximum', 'names']);
                if (!self::isNonnegativeInteger($oldPlayers['maximum'] ?? null) || $oldPlayers['maximum'] > 100000
                    || !is_array($oldPlayers['names'] ?? null) || !array_is_list($oldPlayers['names'])
                    || count($oldPlayers['names']) > $oldPlayers['maximum']) {
                    throw new \RuntimeException('Invalid legacy Minecraft player roster');
                }
                foreach ($oldPlayers['names'] as $name) {
                    if (!is_string($name) || !preg_match('/^[^\p{Cc}<>]{1,64}$/uD', $name)) {
                        throw new \RuntimeException('Invalid legacy Minecraft player name');
                    }
                }
                if (count(array_unique($oldPlayers['names'], SORT_STRING)) !== count($oldPlayers['names'])
                    || $data['java']['state'] !== 'online') {
                    throw new \RuntimeException('Invalid legacy Minecraft player roster');
                }
            }
            if ($result['java']['state'] === 'online') $result['java']['state'] = 'unavailable';
            if ($result['state'] === 'online' && $result['bedrock']['state'] !== 'online') $result['state'] = 'unavailable';
            return $result;
        }
        $hasPlayers = array_key_exists('players', $data);
        if ($hasPlayers) {
            $players = self::objectFields($data['players'], ['maximum', 'names', 'identities']);
            if (!self::isNonnegativeInteger($players['maximum'] ?? null) || $players['maximum'] > 100000
                || !is_array($players['names'] ?? null) || !array_is_list($players['names']) || count($players['names']) > $players['maximum']) { throw new \RuntimeException('Invalid Minecraft player roster'); }
            foreach ($players['names'] as $name) {
                if (!is_string($name) || !preg_match('/^[^\p{Cc}<>]{1,64}$/uD', $name)) { throw new \RuntimeException('Invalid Minecraft player name'); }
            }
            if (!is_array($players['identities'] ?? null) || !array_is_list($players['identities'])
                || count($players['identities']) !== count($players['names'])) {
                throw new \RuntimeException('Minecraft identity roster differs from names');
            }
            $identityNames = [];
            $identityUuids = [];
            $identities = [];
            foreach ($players['identities'] as $identity) {
                $identity = self::objectFields($identity, ['name', 'uuid']);
                if (!is_string($identity['name'] ?? null) || !is_string($identity['uuid'] ?? null)
                    || !preg_match('/^[^\p{Cc}<>]{1,64}$/uD', $identity['name'])
                    || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $identity['uuid'])) {
                    throw new \RuntimeException('Invalid Minecraft player identity');
                }
                $identityNames[] = $identity['name'];
                $identityUuids[] = strtolower($identity['uuid']);
                $identities[] = ['name'=>$identity['name'], 'uuid'=>$identity['uuid']];
            }
            sort($identityNames, SORT_STRING);
            $rosterNames = $players['names'];
            sort($rosterNames, SORT_STRING);
            if ($identityNames !== $rosterNames || count(array_unique($identityUuids)) !== count($identityUuids)) {
                throw new \RuntimeException('Minecraft identity roster differs from names');
            }
            if (count(array_unique($players['names'], SORT_STRING)) !== count($players['names'])) { throw new \RuntimeException('Duplicate Minecraft player names'); }
            if ($data['java']['state'] !== 'online') { throw new \RuntimeException('Player roster requires a successful Query check'); }
            if ($fresh) { $result['players'] = ['maximum'=>(int)$players['maximum'], 'names'=>$players['names'], 'identities'=>$identities]; }
        }
        if ($data['java']['state'] === 'online' && !$hasPlayers) { throw new \RuntimeException('Online Query response is missing its roster'); }
        if (array_key_exists('games', $data)) {
            if (!is_array($data['games']) || !array_is_list($data['games']) || count($data['games']) > 1000) {
                throw new \RuntimeException('Invalid Minecraft game summaries');
            }
            $gameIds = [];
            $games = [];
            foreach ($data['games'] as $game) {
                $game = self::objectFields($game, ['id', 'kind', 'name', 'phase', 'progress', 'players']);
                if (!is_string($game['id'] ?? null) || $game['id'] === '' || mb_strlen($game['id'], 'UTF-8') > 64
                    || !is_string($game['name'] ?? null) || $game['name'] === '' || mb_strlen($game['name'], 'UTF-8') > 64
                    || !in_array($game['kind'] ?? null, ['ARENA', 'RWF'], true)
                    || !in_array($game['phase'] ?? null, ['WAITING', 'STARTING', 'RUNNING'], true)
                    || (array_key_exists('progress', $game) && (!is_string($game['progress']) || mb_strlen($game['progress'], 'UTF-8') > 32))
                    || !self::isNonnegativeInteger($game['players'] ?? null) || $game['players'] < 1
                    || $game['players'] > count($players['identities'] ?? [])) {
                    throw new \RuntimeException('Invalid Minecraft game summary');
                }
                $key = $game['kind'] . ':' . $game['id'];
                if (isset($gameIds[$key])) throw new \RuntimeException('Duplicate Minecraft game summary');
                $gameIds[$key] = true;
                $game['players'] = (int)$game['players'];
                $games[] = $game;
            }
            if ($data['java']['state'] !== 'online') throw new \RuntimeException('Minecraft games require a successful Query check');
            if ($fresh) $result['games'] = $games;
        }
        if ($data['java']['state'] === 'online' && !array_key_exists('games', $data)) {
            throw new \RuntimeException('Online Query response is missing game summaries');
        }
        return $result;
    }
}
