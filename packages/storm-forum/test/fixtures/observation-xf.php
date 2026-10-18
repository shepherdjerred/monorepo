<?php
// Synthetic protocol fixture: XF bootstrap closes existing output buffers.
// This contains no licensed application code and never connects to a database.
namespace {
    final class XF {
        public static function start(string $root): void {
            while (ob_get_level() > 0) { ob_end_clean(); }
        }
        public static function setupApp(string $class): object {
            return new class {
                public function start(): void {}
                public function db(): object {
                    return new class {
                        public function fetchOne(string $query): string {
                            if ($query !== "SELECT version_string FROM xf_addon WHERE addon_id = 'XF'") {
                                throw new \RuntimeException('Observation attempted an unexpected query.');
                            }
                            return '2.3.13';
                        }
                    };
                }
            };
        }
    }
}
namespace XF\Install {
    final class Helper {
        public function __construct(object $app) {}
        public function isInstalled(): bool { return true; }
    }
}
