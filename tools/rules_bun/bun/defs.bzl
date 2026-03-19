"""Public API for rules_bun."""

load("//tools/rules_bun/bun:providers.bzl", _BunInfo = "BunInfo", _BunTreeInfo = "BunTreeInfo")
load("//tools/rules_bun/bun/private:bun_binary.bzl", _bun_binary = "bun_binary")
load("//tools/rules_bun/bun/private:bun_build.bzl", _bun_build = "bun_build")
load("//tools/rules_bun/bun/private:bun_build_test.bzl", _bun_build_test = "bun_build_test")
load("//tools/rules_bun/bun/private:bun_eslint_test.bzl", _bun_eslint_test = "bun_eslint_test")
load("//tools/rules_bun/bun/private:bun_library.bzl", _bun_library = "bun_library")
load("//tools/rules_bun/bun/private:bun_prepared_tree.bzl", _bun_prepared_tree = "bun_prepared_tree")
load("//tools/rules_bun/bun/private:bun_prisma_generate.bzl", _bun_prisma_generate = "bun_prisma_generate")
load("//tools/rules_bun/bun/private:bun_test.bzl", _bun_test = "bun_test")

BunInfo = _BunInfo
BunTreeInfo = _BunTreeInfo
bun_library = _bun_library
bun_prisma_generate = _bun_prisma_generate

def bun_prepared_tree(node_modules = ":node_modules", **kwargs):
    _bun_prepared_tree(node_modules = node_modules, **kwargs)

def bun_binary(node_modules = ":node_modules", **kwargs):
    _bun_binary(node_modules = node_modules, **kwargs)

def bun_eslint_test(node_modules = ":node_modules", **kwargs):
    _bun_eslint_test(node_modules = node_modules, **kwargs)

def bun_test(node_modules = ":node_modules", **kwargs):
    _bun_test(node_modules = node_modules, **kwargs)

def bun_vite_build(
        name,
        deps,
        extra_files = [],
        data = [],
        env = {},
        node_modules = ":node_modules",
        **kwargs):
    """Hermetic Vite build. Produces a TreeArtifact of dist/."""
    tree_name = name + "_tree"
    _bun_prepared_tree(
        name = tree_name,
        deps = deps,
        extra_files = extra_files,
        data = data,
        node_modules = node_modules,
    )
    _bun_build(
        name = name,
        prepared_tree = ":" + tree_name,
        build_cmd = "bun ./node_modules/vite/bin/vite.js build",
        output_dir = "dist",
        env = env,
        **kwargs
    )

def bun_astro_build(
        name,
        deps,
        extra_files = [],
        data = [],
        env = {},
        node_modules = ":node_modules",
        **kwargs):
    """Hermetic Astro build. Produces a TreeArtifact of dist/."""
    tree_name = name + "_tree"
    _bun_prepared_tree(
        name = tree_name,
        deps = deps,
        extra_files = extra_files,
        data = data,
        node_modules = node_modules,
    )
    _bun_build(
        name = name,
        prepared_tree = ":" + tree_name,
        build_cmd = "bun ./node_modules/astro/astro.js build",
        output_dir = "dist",
        env = env,
        **kwargs
    )

def bun_astro_check(
        name,
        deps,
        extra_files = [],
        data = [],
        node_modules = ":node_modules",
        tags = [],
        **kwargs):
    """Hermetic Astro type check. Produces a stamp file."""
    tree_name = name + "_tree"
    _bun_prepared_tree(
        name = tree_name,
        deps = deps,
        extra_files = extra_files,
        data = data,
        node_modules = node_modules,
    )
    _bun_build_test(
        name = name,
        prepared_tree = ":" + tree_name,
        build_cmd = "bun ./node_modules/astro/astro.js check",
        env = {},
        tags = ["typecheck"] + tags,
        **kwargs
    )
