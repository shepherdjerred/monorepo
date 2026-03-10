"""Public API for rules_bun TypeScript support."""

load("//tools/rules_bun/ts/private:bun_typecheck.bzl", _bun_typecheck_test = "bun_typecheck_test")

def bun_typecheck_test(node_modules = ":node_modules", **kwargs):
    _bun_typecheck_test(node_modules = node_modules, **kwargs)
