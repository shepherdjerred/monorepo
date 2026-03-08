"""Public API for rules_bun TypeScript support."""

load("//tools/rules_bun/ts/private:bun_typecheck.bzl", _bun_typecheck_test = "bun_typecheck_test")

bun_typecheck_test = _bun_typecheck_test
