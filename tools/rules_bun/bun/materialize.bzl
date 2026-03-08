"""Public API for materialize_tree."""

load("//tools/rules_bun/bun/private:materialize.bzl", _collect_all_npm_sources = "collect_all_npm_sources", _materialize_tree = "materialize_tree")

collect_all_npm_sources = _collect_all_npm_sources
materialize_tree = _materialize_tree
