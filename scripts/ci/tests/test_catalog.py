"""Tests for ci.lib.catalog module."""

from __future__ import annotations

import pytest

from ci.lib.catalog import (
    ALIASES,
    DEPLOY_SITES,
    DEPLOY_TARGETS,
    HELM_CHARTS,
    IMAGE_PUSH_TARGETS,
    INFRA_PUSH_TARGETS,
    NPM_PACKAGES,
    PACKAGE_TO_SITE,
    TOFU_STACKS,
    VERSION_KEYS,
    resolve_targets,
)


class TestCatalogIntegrity:
    def test_image_push_targets_count(self) -> None:
        assert len(IMAGE_PUSH_TARGETS) == 9

    def test_infra_push_targets_count(self) -> None:
        assert len(INFRA_PUSH_TARGETS) == 4

    def test_npm_packages_count(self) -> None:
        assert len(NPM_PACKAGES) == 4

    def test_deploy_sites_count(self) -> None:
        assert len(DEPLOY_SITES) == 6

    def test_tofu_stacks_count(self) -> None:
        assert len(TOFU_STACKS) == 3

    def test_helm_charts_count(self) -> None:
        assert len(HELM_CHARTS) == 29

    def test_version_keys_count(self) -> None:
        assert len(VERSION_KEYS) == 13

    def test_image_targets_have_required_fields(self) -> None:
        for img in IMAGE_PUSH_TARGETS + INFRA_PUSH_TARGETS:
            assert "target" in img, f"Missing 'target' in {img}"
            assert "version_key" in img, f"Missing 'version_key' in {img}"
            assert "name" in img, f"Missing 'name' in {img}"

    def test_npm_packages_have_required_fields(self) -> None:
        for pkg in NPM_PACKAGES:
            assert "name" in pkg
            assert "dir" in pkg

    def test_deploy_sites_have_required_fields(self) -> None:
        for site in DEPLOY_SITES:
            assert "bucket" in site
            assert "name" in site
            assert "build_dir" in site
            assert "dist_dir" in site

    def test_version_keys_match_push_targets(self) -> None:
        all_push_keys = {img["version_key"] for img in IMAGE_PUSH_TARGETS + INFRA_PUSH_TARGETS}
        version_keys_set = set(VERSION_KEYS)
        assert version_keys_set == all_push_keys, (
            f"Mismatch: VERSION_KEYS has {version_keys_set - all_push_keys} extra, "
            f"missing {all_push_keys - version_keys_set}"
        )

    def test_deploy_targets_cover_all_helm_charts(self) -> None:
        dt_charts = set()
        for dt in DEPLOY_TARGETS.values():
            dt_charts.update(dt.charts)
        helm_set = set(HELM_CHARTS)
        assert dt_charts == helm_set, (
            f"DEPLOY_TARGETS charts {dt_charts - helm_set} not in HELM_CHARTS, "
            f"HELM_CHARTS {helm_set - dt_charts} not in any DEPLOY_TARGET"
        )

    def test_package_to_site_keys_exist(self) -> None:
        assert len(PACKAGE_TO_SITE) == 5


class TestAliasResolution:
    def test_tasks_alias(self) -> None:
        result = resolve_targets(["tasks"])
        assert result == ["tasknotes"]

    def test_scout_alias(self) -> None:
        result = resolve_targets(["scout"])
        assert "scout-beta" in result
        assert "scout-prod" in result

    def test_karma_alias(self) -> None:
        result = resolve_targets(["karma"])
        assert "starlight-karma-bot-beta" in result
        assert "starlight-karma-bot-prod" in result

    def test_no_alias_passthrough(self) -> None:
        result = resolve_targets(["birmel"])
        assert result == ["birmel"]

    def test_deduplication(self) -> None:
        result = resolve_targets(["birmel", "birmel"])
        assert result == ["birmel"]

    def test_mixed_alias_and_literal(self) -> None:
        result = resolve_targets(["tasks", "birmel"])
        assert "tasknotes" in result
        assert "birmel" in result

    def test_validation_rejects_unknown(self) -> None:
        with pytest.raises(ValueError, match="not-a-target"):
            resolve_targets(["not-a-target"], valid_targets={"birmel", "sentinel"})

    def test_validation_accepts_known(self) -> None:
        result = resolve_targets(["birmel"], valid_targets={"birmel", "sentinel"})
        assert result == ["birmel"]


class TestDeployTargets:
    def test_birmel_has_image(self) -> None:
        dt = DEPLOY_TARGETS["birmel"]
        assert len(dt.images) == 1
        assert dt.images[0]["name"] == "birmel"

    def test_tasknotes_has_two_images(self) -> None:
        dt = DEPLOY_TARGETS["tasknotes"]
        assert len(dt.images) == 2
        names = {img["name"] for img in dt.images}
        assert "tasknotes-server" in names
        assert "obsidian-headless" in names

    def test_redlib_has_no_images(self) -> None:
        dt = DEPLOY_TARGETS["redlib"]
        assert len(dt.images) == 0

    def test_scout_beta_has_image(self) -> None:
        dt = DEPLOY_TARGETS["scout-beta"]
        assert len(dt.images) == 1
        assert dt.images[0]["name"] == "scout-for-lol"

    def test_all_deploy_targets_have_charts(self) -> None:
        for name, dt in DEPLOY_TARGETS.items():
            assert len(dt.charts) > 0, f"DEPLOY_TARGET '{name}' has no charts"

    def test_all_deploy_targets_have_argo_apps(self) -> None:
        for name, dt in DEPLOY_TARGETS.items():
            assert len(dt.argo_apps) > 0, f"DEPLOY_TARGET '{name}' has no argo_apps"

    def test_all_aliases_resolve_to_deploy_targets(self) -> None:
        for alias, targets in ALIASES.items():
            for t in targets:
                assert t in DEPLOY_TARGETS, f"Alias '{alias}' -> '{t}' not in DEPLOY_TARGETS"
