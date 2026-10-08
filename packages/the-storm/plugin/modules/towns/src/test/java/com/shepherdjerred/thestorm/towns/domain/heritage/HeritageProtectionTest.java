package com.shepherdjerred.thestorm.towns.domain.heritage;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.TownListings;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import com.shepherdjerred.thestorm.towns.domain.world.WorldRules;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class HeritageProtectionTest {
  private static final Path SHIPPED =
      Path.of("../../../server/owned/plugins/TheStorm/heritage.yml");
  private static final EnumSet<WorldEffect> PERMITTED =
      EnumSet.of(
          WorldEffect.GRAZING,
          WorldEffect.GRASS_REGROWTH,
          WorldEffect.CROP_GROWTH,
          WorldEffect.SOIL_MOISTURE,
          WorldEffect.REDSTONE,
          WorldEffect.ITEM_TRANSFER);

  private HeritageConfig catalog() throws Exception {
    var parsed = StrictYaml.parse("heritage.yml", Files.readString(SHIPPED), HeritageConfig.class);
    return switch (parsed) {
      case Result.Ok(var config) -> config;
      case Result.Err(var problems) -> throw new AssertionError(problems);
    };
  }

  private TownsState state() throws Exception {
    var state = new TownsState(new RegionIndex(List.of()));
    state.attachHeritage(new HeritageIndex(catalog().sites()));
    return state;
  }

  @Test
  void catalogContainsEveryReviewedSiteAndSevenProvenMayors() throws Exception {
    var catalog = catalog();
    assertThat(catalog.sites()).hasSize(223);
    assertThat(catalog.sites().stream().filter(site -> site.id().startsWith("archive-")))
        .hasSize(155)
        .allSatisfy(
            site -> {
              assertThat(site.kind()).isEqualTo(HeritageSite.Kind.HERITAGE);
              assertThat(site.editors()).isEmpty();
              assertThat(site.editingChunks()).isEmpty();
            });
    assertThat(catalog.sites().stream().filter(site -> site.id().equals("settlement")))
        .singleElement()
        .extracting(HeritageSite::world)
        .isEqualTo("settlement");
    assertThat(catalog.sites().stream().filter(site -> site.id().equals("rustworks")))
        .singleElement()
        .extracting(HeritageSite::world)
        .isEqualTo("rustworks");
    assertThat(catalog.sites().stream().filter(site -> site.kind() == HeritageSite.Kind.PLAYER))
        .hasSize(7);
    assertThat(catalog.archiveSha256())
        .isEqualTo("89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa");
    assertThat(
            catalog.sites().stream()
                .filter(site -> site.id().equals("heritage-003"))
                .findFirst()
                .orElseThrow()
                .contains(772, 35, 334))
        .isTrue();
  }

  @ParameterizedTest
  @EnumSource(WorldEffect.class)
  void preservationFloorIgnoresMutableTownFlags(WorldEffect effect) throws Exception {
    var state = state();
    var land = state.landAt("world", 68, 69, 66);
    assertThat(WorldRules.allows(effect, land, land)).isEqualTo(PERMITTED.contains(effect));
    if (effect != WorldEffect.GRAZING
        && effect != WorldEffect.GRASS_REGROWTH
        && effect != WorldEffect.CROP_GROWTH
        && effect != WorldEffect.SOIL_MOISTURE) {
      assertThat(WorldRules.allows(effect, new Land.Wilderness(), land)).isFalse();
    }
  }

  @Test
  void spawnIsProtectedAtBothWorldHeightLimitsButColosseumRetainsCombatProfile() throws Exception {
    var state = state();
    assertThat(state.landAt("world", 68, -64, 66).preventsPlayerDamage()).isTrue();
    assertThat(state.landAt("world", 68, 319, 66).preventsPlayerDamage()).isTrue();
    assertThat(state.landAt("world", 200, 80, 0).preventsPlayerDamage()).isFalse();
    assertThat(state.landAt("other-world", 68, 69, 66)).isInstanceOf(Land.Wilderness.class);
  }

  @Test
  void ownersEditOnlyProvenConstructionAndPrivateContainers() throws Exception {
    var state = state();
    var site =
        catalog().sites().stream()
            .filter(value -> value.id().equals("heritage-005"))
            .findFirst()
            .orElseThrow();
    var core = site.editingChunks().iterator().next();
    var buffer =
        site.protectedChunks().stream()
            .filter(chunk -> !site.editingChunks().contains(chunk))
            .findFirst()
            .orElseThrow();
    var engine = new ProtectionEngine(state, player -> true);
    var owner = new Actor(site.editors().getFirst().player(), false);
    var outsider = new Actor(UUID.randomUUID(), false);
    var act = new Act(Action.OPEN_CONTAINER, Subject.CONTAINER);
    var coreLand = state.landAt("world", core.x() * 16, 69, core.z() * 16);
    var bufferLand = state.landAt("world", buffer.x() * 16, 69, buffer.z() * 16);
    assertThat(engine.decide(owner, act, coreLand).isAllowed()).isTrue();
    assertThat(engine.decide(outsider, act, coreLand).isAllowed()).isFalse();
    assertThat(engine.decide(owner, act, bufferLand).isAllowed()).isFalse();
  }

  @Test
  void authoredArenaUsesDoNotOpenHistoricalContainersOrOrdinaryConstruction() throws Exception {
    var catalog = catalog();
    var arena =
        catalog.sites().stream()
            .filter(site -> site.name().equals("The Colosseum"))
            .findFirst()
            .orElseThrow();
    var allowances =
        java.util.List.of(
            new com.shepherdjerred.thestorm.towns.domain.region.RegionAllowance(
                Action.OPEN_CONTAINER, java.util.Set.of(Subject.CONTAINER)),
            new com.shepherdjerred.thestorm.towns.domain.region.RegionAllowance(
                Action.BREAK, java.util.Set.of(Subject.CREAKING_HEART)),
            new com.shepherdjerred.thestorm.towns.domain.region.RegionAllowance(
                Action.BUILD, java.util.Set.of(Subject.ANY)));
    var region =
        new com.shepherdjerred.thestorm.towns.domain.region.AdminRegion(
            "arena",
            "Arena",
            new com.shepherdjerred.thestorm.towns.domain.region.RegionAreas(
                java.util.List.of(), arena.protectedAreas()),
            allowances,
            com.shepherdjerred.thestorm.towns.domain.region.RegionSpawns.unlimited(),
            com.shepherdjerred.thestorm.towns.domain.region.RegionProfile.ARENA);
    var underlying = new Land.RegionLand(region);
    var land = new Land.HeritageLand(arena, java.util.Set.of(), underlying);
    var state = state();
    var engine = new ProtectionEngine(state, player -> true);
    var outsider = Actor.player(UUID.randomUUID());
    var open = new Act(Action.OPEN_CONTAINER, Subject.CONTAINER);
    assertThat(engine.decide(outsider, open, land).isAllowed()).isTrue();
    assertThat(
            engine
                .decide(outsider, new Act(Action.BREAK, Subject.CREAKING_HEART), land)
                .isAllowed())
        .isTrue();
    assertThat(engine.decide(outsider, new Act(Action.BREAK, Subject.BLOCK), land).isAllowed())
        .isFalse();
    assertThat(engine.decide(outsider, new Act(Action.BUILD, Subject.BLOCK), land).isAllowed())
        .isFalse();
    assertThat(
            engine
                .decide(
                    outsider,
                    open,
                    new Land.HeritageLand(arena, java.util.Set.of(), new Land.Wilderness()))
                .isAllowed())
        .isFalse();
    var spawn =
        catalog.sites().stream()
            .filter(site -> site.name().equals("Spawn"))
            .findFirst()
            .orElseThrow();
    assertThat(
            engine
                .decide(
                    outsider, open, new Land.HeritageLand(spawn, java.util.Set.of(), underlying))
                .isAllowed())
        .isFalse();
  }

  @Test
  void directoryIncludesSpawnAndMultiwordNamesWithoutFakeMembers() throws Exception {
    var directory = new TownListings(state());
    assertThat(directory.page(1, 25).towns().getFirst().name()).isEqualTo("Spawn");
    assertThat(directory.page(9, 25).towns()).hasSize(23);
    var lastPageName = directory.page(9, 25).towns().getLast().name();
    assertThat(directory.matchingNames(lastPageName.toUpperCase(java.util.Locale.ROOT)))
        .containsExactly(lastPageName);
    assertThat(directory.matchingNames("")).hasSize(223);
    var falls = directory.info("Frost_Falls").orElseThrow();
    assertThat(falls.name()).isEqualTo("Frost Falls");
    assertThat(falls.members()).isZero();
    assertThat(falls.claims()).isZero();
    assertThat(falls.protectedChunks()).isPositive();
  }

  @Test
  void importedTownIdentitySurvivesRenameAndDisbandWithoutDuplicateDirectoryEntries()
      throws Exception {
    var state = state();
    var site =
        catalog().sites().stream()
            .filter(value -> value.kind() == HeritageSite.Kind.PLAYER)
            .findFirst()
            .orElseThrow();
    var town =
        com.shepherdjerred.thestorm.towns.domain.town.Town.found(
            site.activeTownId().orElseThrow(),
            site.activeTownName(),
            java.time.Instant.EPOCH,
            site.editors().getFirst().player());
    state.addTown(town);
    var directory = new TownListings(state);
    assertThat(directory.info(site.name()).orElseThrow().members()).isEqualTo(1);
    assertThat(directory.page(1, 25).total()).isEqualTo(223);
    state.replaceTown(town.renamed("NewIdentity"));
    assertThat(directory.info("NewIdentity").orElseThrow().name()).isEqualTo(site.name());
    assertThat(directory.info(site.name()).orElseThrow().members()).isEqualTo(1);
    assertThat(directory.page(1, 25).total()).isEqualTo(223);
    state.removeTown(town.id());
    assertThat(directory.info(site.name()).orElseThrow().members()).isZero();
    assertThat(state.heritageNameReserved(site.activeTownName(), java.util.Optional.empty()))
        .isTrue();
    var chunk = site.protectedChunks().iterator().next();
    assertThat(state.landAt(site.world(), chunk.x() * 16, 69, chunk.z() * 16))
        .isInstanceOf(Land.HeritageLand.class);
  }
}
