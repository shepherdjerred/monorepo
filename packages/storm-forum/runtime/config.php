<?php
// This file contains credential references only. It is safe to include in the public image.
$required = static function (string $name): string {
    $value = getenv($name);
    if ($value === false || $value === '') {
        throw new RuntimeException("Missing bootstrap credential: {$name}");
    }
    return $value;
};
$config['db'] = [
    'host' => $required('DB_HOST'), 'port' => 3306,
    'username' => $required('DB_USER'), 'password' => $required('DB_PASSWORD'),
    'dbname' => $required('DB_NAME'),
];
$config['fullUnicode'] = true;
$config['enableOneClickUpgrade'] = false;
$config['enableAddOnArchiveInstaller'] = false;
$config['cookie']['prefix'] = 'storm_';
$config['debug'] = false;
$config['development']['enabled'] = false;
$config['checkVersion'] = true;
$config['internalDataPath'] = '/var/lib/storm-forum/internal_data';
$config['externalDataPath'] = 'data';
$config['tempDataPath'] = '/tmp/storm-forum';
// Nginx is the trusted proxy; public client IP forwarding is restricted at ingress.
