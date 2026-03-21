"""Public API for rules_bun2."""

load("//tools/rules_bun2/bun:providers.bzl", _BunInfo = "BunInfo")
load("//tools/rules_bun2/bun/private:bun_eslint_test.bzl", _bun_eslint_test = "bun_eslint_test")
load("//tools/rules_bun2/bun/private:bun_prisma_brand.bzl", _bun_prisma_brand = "bun_prisma_brand")
load("//tools/rules_bun2/bun/private:bun_library.bzl", _bun_library = "bun_library")
load("//tools/rules_bun2/bun/private:bun_test.bzl", _bun_test = "bun_test")
load("//tools/rules_bun2/bun/private:bun_typecheck_test.bzl", _bun_typecheck_test = "bun_typecheck_test")

BunInfo = _BunInfo
bun_library = _bun_library
bun_prisma_brand = _bun_prisma_brand

def bun_test(node_modules = ":node_modules", **kwargs):
    _bun_test(node_modules = node_modules, **kwargs)

def bun_eslint_test(node_modules = ":node_modules", **kwargs):
    _bun_eslint_test(node_modules = node_modules, **kwargs)

def bun_typecheck_test(node_modules = ":node_modules", **kwargs):
    _bun_typecheck_test(node_modules = node_modules, **kwargs)
