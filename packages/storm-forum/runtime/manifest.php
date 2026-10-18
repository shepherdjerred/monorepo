<?php
// Both runtimes validate the same neutral licensed dependency policy. Product
// content remains owned by this package; duplicate dependency pins fail closed.
return static function (
    string $productPath = '/opt/storm-forum/config/forum.json',
    string $policyPath = '/app/packages/ops-model/src/forum-bundle-policy.json'
): array {
    $product = json_decode(file_get_contents($productPath), true, 512, JSON_THROW_ON_ERROR);
    $policy = json_decode(file_get_contents($policyPath), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($product) || !is_array($policy) || ($product['schemaVersion'] ?? null) !== 1 || ($policy['schemaVersion'] ?? null) !== 1
        || array_key_exists('xenforoVersion', $product) || array_key_exists('vendorDependencies', $product)
        || !is_string($policy['xenforoVersion'] ?? null) || !preg_match('/^\d+\.\d+\.\d+$/D', $policy['xenforoVersion'])
        || !is_array($policy['vendorDependencies'] ?? null) || count($policy['vendorDependencies']) !== 2) {
        throw new RuntimeException('Invalid or duplicated licensed dependency policy');
    }
    $keys = array_keys($policy); sort($keys);
    if ($keys !== ['schemaVersion', 'vendorDependencies', 'xenforoVersion']) { throw new RuntimeException('Unknown licensed policy fields'); }
    $modes = []; $paths = []; $names = [];
    foreach ($policy['vendorDependencies'] as $dependency) {
        if (!is_array($dependency)) { throw new RuntimeException('Invalid licensed dependency'); }
        $fields = array_keys($dependency); sort($fields);
        if ($fields !== ['key', 'kind', 'mode', 'path', 'sha256', 'version'] || ($dependency['kind'] ?? null) !== 'style'
            || !in_array($dependency['mode'] ?? null, ['light', 'dark'], true)
            || !is_string($dependency['key'] ?? null) || !preg_match('/^[a-z][a-z-]+$/D', $dependency['key'])
            || !is_string($dependency['version'] ?? null) || !preg_match('/^\d+\.\d+\.\d+$/D', $dependency['version'])
            || !is_string($dependency['path'] ?? null) || !preg_match('/^vendor\/[a-z][\w.-]+\.zip$/D', $dependency['path'])
            || !is_string($dependency['sha256'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $dependency['sha256'])
            || in_array($dependency['mode'], $modes, true) || in_array($dependency['path'], $paths, true) || in_array($dependency['key'], $names, true)) {
            throw new RuntimeException('Invalid or repeated licensed dependency');
        }
        $modes[] = $dependency['mode']; $paths[] = $dependency['path']; $names[] = $dependency['key'];
    }
    return array_replace($product, $policy);
};
