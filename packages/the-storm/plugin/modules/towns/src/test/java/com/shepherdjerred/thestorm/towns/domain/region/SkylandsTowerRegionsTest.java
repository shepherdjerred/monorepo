package com.shepherdjerred.thestorm.towns.domain.region;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import com.shepherdjerred.thestorm.towns.domain.world.WorldRules;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** Public infrastructure and its approaches must stay usable without allowing grief. */
final class SkylandsTowerRegionsTest {

  private static AdminRegion towers() {
    var config =
        ConfigFiles.load(
            Path.of("../../../server/owned/plugins/TheStorm/towns.yml"), TownsConfig.class);
    return new RegionIndex(config.regions()).byId("skylands-towers").orElseThrow();
  }

  @Test
  void allNineteenSitesProtectTheirWholeFootprintThroughBuildHeight() {
    var region = towers();
    var index = new RegionIndex(List.of(region));
    var boxes = region.areas().cuboids();
    assertThat(region.areas().chunks()).isEmpty();
    assertThat(boxes.size()).isGreaterThan(19);
    for (var apron : boxes.subList(0, 19)) {
      var x = apron.from().x() + 48;
      var z = apron.from().z() + 48;
      assertThat(apron.world()).isEqualTo("skylands");
      assertThat(apron.to()).isEqualTo(new BlockCorner(x + 48, 319, z + 48));
      for (var dx : List.of(-48, 48)) {
        for (var dz : List.of(-48, 48)) {
          assertThat(index.at("skylands", x + dx, apron.from().y(), z + dz)).contains(region);
          assertThat(index.at("skylands", x + dx, apron.to().y(), z + dz)).contains(region);
          assertThat(Math.hypot(x + dx, z + dz)).isLessThan(3000);
        }
      }
      // A roof beside the old narrow shaft and tall perimeter walls must remain forbidden.
      assertThat(index.at("skylands", x + 13, 319, z)).contains(region);
      assertThat(index.at("skylands", x + 200, apron.to().y(), z)).isEmpty();
      assertThat(index.at("skylands", x, apron.from().y() - 1, z)).isEmpty();
      assertThat(index.at("frontier", x, apron.to().y(), z)).isEmpty();
      assertThat(index.overlapping(new ChunkPos("skylands", x >> 4, z >> 4))).contains(region);
    }
  }

  @Test
  void everyApproachHasEightBlocksOfProtectionBeyondItsDeckEdges() throws IOException {
    var json = new JsonMapper();
    var catalog =
        json.readTree(
            Files.readString(Path.of("../../../server/owned/plugins/TheStorm/skytravel.json")));
    var layout =
        json.readTree(Files.readString(Path.of("../../../tools/skylands/towers/approaches.json")));
    var region = towers();
    var index = new RegionIndex(List.of(region));
    for (var tower : catalog.required("towers")) {
      assertThat(tower.required("commissioned").booleanValue()).isTrue();
      var id = tower.required("id").stringValue();
      var approach =
          java.util.stream.StreamSupport.stream(layout.required("towers").spliterator(), false)
              .filter(entry -> entry.required("id").stringValue().equals(id))
              .findFirst()
              .orElseThrow();
      var points = approach.required("waypoints");
      for (var i = 1; i < points.size(); i++) {
        checkApproachSegment(index, tower, points.get(i - 1), points.get(i));
      }
    }
  }

  private static void checkApproachSegment(
      RegionIndex index,
      tools.jackson.databind.JsonNode tower,
      tools.jackson.databind.JsonNode from,
      tools.jackson.databind.JsonNode to) {
    var base = tower.required("base");
    var id = tower.required("id").stringValue();
    var region = index.byId("skylands-towers").orElseThrow();
    var steps =
        Math.abs(to.get(0).intValue() - from.get(0).intValue())
            + Math.abs(to.get(2).intValue() - from.get(2).intValue());
    for (var step = 0; step <= steps; step++) {
      var x =
          base.required("x").intValue()
              + from.get(0).intValue()
              + (to.get(0).intValue() - from.get(0).intValue()) * step / steps;
      var z =
          base.required("z").intValue()
              + from.get(2).intValue()
              + (to.get(2).intValue() - from.get(2).intValue()) * step / steps;
      for (var dx : List.of(-10, 10))
        for (var dz : List.of(-10, 10)) {
          assertThat(index.at("skylands", x + dx, base.required("y").intValue() - 16, z + dz))
              .as("%s approach buffer at %s,%s", id, x + dx, z + dz)
              .contains(region);
          assertThat(index.at("skylands", x + dx, 319, z + dz)).contains(region);
        }
    }
  }

  @Test
  void indirectGriefCannotEnterFromOutsideTheReservation() {
    var land = new Land.RegionLand(towers());
    var outside = new Land.Wilderness();
    for (var effect : WorldEffect.values()) {
      assertThat(WorldRules.allows(effect, outside, land)).as("incoming %s", effect).isFalse();
    }
    for (var effect :
        List.of(
            WorldEffect.EXPLOSION,
            WorldEffect.FIRE_SPREAD,
            WorldEffect.FIRE_BURN,
            WorldEffect.MOB_GRIEF,
            WorldEffect.FALLING_BLOCK,
            WorldEffect.TREE_GROWTH,
            WorldEffect.SCULK_SPREAD,
            WorldEffect.PORTAL_CREATION)) {
      assertThat(WorldRules.allows(effect, land, land)).as("internal %s", effect).isFalse();
    }
  }

  @Test
  void visitorsCanUseTheSiteButCannotBuildOrRemoveIt() {
    var region = towers();
    var land = new Land.RegionLand(region);
    var visitor = Actor.player(Fixtures.NOMAD);
    var engine = new ProtectionEngine(Fixtures.trust(), _ -> true);
    for (var action : List.of(Action.BUILD, Action.BREAK, Action.PLACE_ENTITY)) {
      assertThat(engine.decide(visitor, new Act(action, Subject.BLOCK), land).isAllowed())
          .isFalse();
      assertThat(
              engine
                  .decide(new Actor(Fixtures.OWNER, true), new Act(action, Subject.BLOCK), land)
                  .isAllowed())
          .isTrue();
    }
    for (var subject :
        List.of(Subject.DOOR, Subject.BUTTON, Subject.LEVER, Subject.PRESSURE_PLATE)) {
      assertThat(engine.decide(visitor, new Act(Action.INTERACT, subject), land).isAllowed())
          .isTrue();
    }
    for (var subject :
        List.of(Subject.ARMOR_STAND, Subject.ITEM_FRAME, Subject.VEHICLE, Subject.VILLAGER)) {
      assertThat(engine.decide(visitor, new Act(Action.DAMAGE_ENTITY, subject), land).isAllowed())
          .as("damage to %s", subject)
          .isFalse();
    }
    for (var subject : List.of(Subject.LOCATION, Subject.ENDER_PEARL, Subject.CHORUS_FRUIT)) {
      assertThat(engine.decide(visitor, new Act(Action.TELEPORT_INTO, subject), land).isAllowed())
          .isTrue();
    }
    assertThat(
            engine
                .decide(visitor, new Act(Action.OPEN_CONTAINER, Subject.CONTAINER), land)
                .isAllowed())
        .isTrue();
    assertThat(region.mobSpawns()).isEqualTo(RegionSpawns.unlimited());
    assertThat(region.profile()).isEqualTo(RegionProfile.PRESERVE);
    assertThat(land.preventsPlayerDamage()).isFalse();
    assertThat(engine.decidePvp(visitor, Fixtures.OWNER, land, land).isAllowed()).isTrue();
    var pvpOff = new ProtectionEngine(Fixtures.trust(), _ -> false);
    assertThat(pvpOff.decidePvp(visitor, Fixtures.OWNER, land, land).isAllowed()).isFalse();
  }
}
