"""Public API for rules_bun."""

load("//tools/rules_bun/bun:providers.bzl", _BunInfo = "BunInfo")
load("//tools/rules_bun/bun/private:bun_binary.bzl", _bun_binary = "bun_binary")
load("//tools/rules_bun/bun/private:bun_eslint_test.bzl", _bun_eslint_test = "bun_eslint_test")
load("//tools/rules_bun/bun/private:bun_library.bzl", _bun_library = "bun_library")
load("//tools/rules_bun/bun/private:bun_prisma_generate.bzl", _bun_prisma_generate = "bun_prisma_generate")
load("//tools/rules_bun/bun/private:bun_test.bzl", _bun_test = "bun_test")

BunInfo = _BunInfo
bun_library = _bun_library
bun_prisma_generate = _bun_prisma_generate

def bun_binary(node_modules = ":node_modules", **kwargs):
    _bun_binary(node_modules = node_modules, **kwargs)

def bun_eslint_test(node_modules = ":node_modules", **kwargs):
    _bun_eslint_test(node_modules = node_modules, **kwargs)

def bun_test(node_modules = ":node_modules", **kwargs):
    _bun_test(node_modules = node_modules, **kwargs)
