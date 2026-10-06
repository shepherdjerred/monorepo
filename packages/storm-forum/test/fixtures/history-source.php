<?php
namespace Storm\Forum\Cli\Command;

// Test-only filesystem boundary: run the real command against a revised corpus
// while keeping the source corpus and read-only fixture mount untouched.
function file_get_contents(string $filename): string|false
{
    if ($filename === '/opt/storm-forum/config/history.json' && isset($GLOBALS['stormFixtureHistory'])) {
        return json_encode($GLOBALS['stormFixtureHistory'], JSON_THROW_ON_ERROR);
    }
    return \file_get_contents($filename);
}
