<?php
declare(strict_types=1);

require '/var/www/FreshRSS/cli/_cli.php';

function failFilterReconciliation(string $message): never {
	fwrite(STDERR, $message . "\n");
	exit(1);
}

$username = getenv('FRESHRSS_USER');
$manifestPath = getenv('FRESHRSS_MANIFEST_PATH');
if (!is_string($username) || $username === '') {
	failFilterReconciliation('FRESHRSS_USER is required');
}
if (!is_string($manifestPath) || $manifestPath === '') {
	failFilterReconciliation('FRESHRSS_MANIFEST_PATH is required');
}

$manifestJson = file_get_contents($manifestPath);
if ($manifestJson === false) {
	failFilterReconciliation('FreshRSS desired manifest is not readable');
}
try {
	$manifest = json_decode($manifestJson, true, flags: JSON_THROW_ON_ERROR);
} catch (JsonException) {
	failFilterReconciliation('FreshRSS desired manifest is not valid JSON');
}
if (!is_array($manifest) || !isset($manifest['feeds']) || !is_array($manifest['feeds'])) {
	failFilterReconciliation('FreshRSS desired manifest does not contain feeds');
}

$username = cliInitUser($username);

// FreshRSS stores a filter in its own serialized form (for example `!intitle:`
// becomes `-intitle:`). A declared filter in any other form would be rewritten
// on every pass and never match the export the Temporal sync verifies, so
// refuse the whole manifest before writing anything.
foreach ($manifest['feeds'] as $index => $desiredFeed) {
	if (!is_array($desiredFeed) || !isset($desiredFeed['url']) || !is_string($desiredFeed['url'])) {
		failFilterReconciliation('FreshRSS desired feed ' . $index . ' does not contain a URL');
	}
	$desiredFilter = $desiredFeed['filtersActionRead'] ?? null;
	if ($desiredFilter !== null && !is_string($desiredFilter)) {
		failFilterReconciliation('FreshRSS desired feed ' . $index . ' has an invalid read filter');
	}
	if ($desiredFilter !== null) {
		$canonicalFilter = (new FreshRSS_BooleanSearch($desiredFilter))->toString();
		if ($canonicalFilter !== $desiredFilter) {
			failFilterReconciliation('FreshRSS stores the read filter for ' . $desiredFeed['url'] . ' as ' .
				json_encode($canonicalFilter, JSON_UNESCAPED_SLASHES) . '; declare that form instead of ' .
				json_encode($desiredFilter, JSON_UNESCAPED_SLASHES));
		}
	}
}

$feedDao = FreshRSS_Factory::createFeedDao($username);
$updated = 0;
foreach ($manifest['feeds'] as $desiredFeed) {
	$desiredFilter = $desiredFeed['filtersActionRead'] ?? null;
	$feed = $feedDao->searchByUrl($desiredFeed['url']);
	if ($feed === null) {
		failFilterReconciliation('FreshRSS desired feed is not subscribed: ' . $desiredFeed['url']);
	}
	$desiredFilters = $desiredFilter === null ? [] : [$desiredFilter];
	$currentFilters = array_map(
		static fn($filter): string => $filter->toString(),
		$feed->filtersAction('read'),
	);
	sort($currentFilters, SORT_STRING);
	sort($desiredFilters, SORT_STRING);
	if ($currentFilters !== $desiredFilters) {
		$feed->_filtersAction('read', $desiredFilters);
		if (!$feedDao->updateFeed($feed->id(), ['attributes' => $feed->attributes()])) {
			failFilterReconciliation('FreshRSS could not update read filters for: ' . $desiredFeed['url']);
		}
		$updated++;
	}
}

if ($updated > 0) {
	echo 'FreshRSS filter reconciliation complete: ' . count($manifest['feeds']) .
		' desired, ' . $updated . " updated\n";
}
