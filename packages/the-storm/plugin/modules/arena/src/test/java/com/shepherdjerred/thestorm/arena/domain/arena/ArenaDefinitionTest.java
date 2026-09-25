package com.shepherdjerred.thestorm.arena.domain.arena;

import static com.shepherdjerred.thestorm.arena.testing.Samples.item;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import com.shepherdjerred.thestorm.arena.domain.geometry.Spot;
import com.shepherdjerred.thestorm.arena.domain.kit.ArenaClass;
import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ArenaDefinitionTest {

  private static final Cuboid REGION = new Cuboid(new BlockPos(0, 60, 0), new BlockPos(40, 80, 40));
  private static final Spot INSIDE = new Spot(10.5, 64, 10.5, 0, 0);
  private static final Spot OUTSIDE = new Spot(-5.5, 64, -5.5, 0, 0);

  static ArenaDefinition arena(String id, Cuboid region) {
    return new ArenaDefinition(
        id,
        "Arena " + id,
        "world",
        region,
        INSIDE,
        INSIDE,
        OUTSIDE,
        List.of(INSIDE),
        List.of(new Point(20.5, 64, 20.5)),
        Map.of("knight", new BlockPos(5, 64, 5)),
        new BlockPos(6, 64, 5),
        List.of(new BlockPos(1, 61, 1)),
        List.of(new BlockPos(-3, 64, -3)),
        1,
        1,
        4);
  }

  @Test
  void aValidArena() {
    var arena = arena("colosseum", REGION);

    assertThat(arena.isFixture(new BlockPos(5, 64, 5))).isTrue();
    assertThat(arena.isFixture(new BlockPos(6, 64, 5))).isTrue();
    assertThat(arena.isFixture(new BlockPos(1, 61, 1))).isTrue();
    assertThat(arena.isFixture(new BlockPos(2, 61, 1))).isFalse();
  }

  @Test
  void everyPointButTheExitMustBeInside() {
    assertThatThrownBy(
            () ->
                new ArenaDefinition(
                    "colosseum",
                    "Colosseum",
                    "world",
                    REGION,
                    OUTSIDE,
                    OUTSIDE,
                    INSIDE,
                    List.of(OUTSIDE),
                    List.of(new Point(50, 64, 50)),
                    Map.of("knight", new BlockPos(-1, 64, 5)),
                    new BlockPos(6, 90, 5),
                    List.of(new BlockPos(41, 61, 1)),
                    List.of(),
                    1,
                    1,
                    4))
        .hasMessageContaining("lobby")
        .hasMessageContaining("spectator")
        .hasMessageContaining("exit")
        .hasMessageContaining("playerSpawns[0]")
        .hasMessageContaining("mobSpawns[0]")
        .hasMessageContaining("classSigns.knight")
        .hasMessageContaining("readyBlock")
        .hasMessageContaining("lootChests[0]");
  }

  @Test
  void fixturesCannotShareABlock() {
    assertThatThrownBy(
            () ->
                new ArenaDefinition(
                    "colosseum",
                    "Colosseum",
                    "world",
                    REGION,
                    INSIDE,
                    INSIDE,
                    OUTSIDE,
                    List.of(INSIDE),
                    List.of(new Point(20, 64, 20)),
                    Map.of("knight", new BlockPos(5, 64, 5)),
                    new BlockPos(5, 64, 5),
                    List.of(),
                    List.of(),
                    1,
                    1,
                    4))
        .hasMessageContaining("used twice");
  }

  @Test
  void basicsAreChecked() {
    assertThatThrownBy(() -> arena("Colosseum", REGION)).hasMessageContaining("kebab-case");
    assertThatThrownBy(
            () ->
                new ArenaDefinition(
                    "a",
                    "A",
                    "world",
                    REGION,
                    INSIDE,
                    INSIDE,
                    OUTSIDE,
                    List.of(),
                    List.of(new Point(1, 64, 1)),
                    Map.of(),
                    new BlockPos(6, 64, 5),
                    List.of(),
                    List.of(),
                    1,
                    1,
                    4))
        .hasMessageContaining("player spawns");
    assertThatThrownBy(
            () ->
                new ArenaDefinition(
                    "a",
                    "A",
                    "world",
                    REGION,
                    INSIDE,
                    INSIDE,
                    OUTSIDE,
                    List.of(INSIDE),
                    List.of(new Point(1, 64, 1)),
                    Map.of(),
                    new BlockPos(6, 64, 5),
                    List.of(),
                    List.of(),
                    1,
                    3,
                    2))
        .hasMessageContaining("minPlayers");
    assertThatThrownBy(
            () ->
                new ArenaDefinition(
                    "a",
                    "A",
                    "world",
                    REGION,
                    INSIDE,
                    INSIDE,
                    OUTSIDE,
                    List.of(INSIDE),
                    List.of(new Point(1, 64, 1)),
                    Map.of(),
                    new BlockPos(6, 64, 5),
                    List.of(),
                    List.of(),
                    0,
                    1,
                    2))
        .hasMessageContaining("tier");
  }

  @Test
  void contentMustAgreeAcrossFiles() {
    var classes =
        new ClassBook(
            Map.of(
                "archer",
                new ArenaClass("Archer", false, List.of(item("BOW")), List.of(), Map.of(), 0)));
    var overlapping = new Cuboid(new BlockPos(0, 60, 0), new BlockPos(45, 85, 45));
    var high = arena("maze", overlapping);

    var problems = ArenaContent.check(List.of(arena("colosseum", REGION), high, high), classes, 0);

    assertThat(problems)
        .contains("two arenas have the id maze")
        .contains("arena colosseum has a sign for unknown class knight")
        .contains("arena colosseum uses tier 1 but only 0 exist")
        .contains("arenas colosseum and maze overlap");
  }

  @Test
  void arenasInDifferentWorldsNeverOverlap() {
    var classes =
        new ClassBook(
            Map.of(
                "knight",
                new ArenaClass(
                    "Knight", false, List.of(item("IRON_SWORD")), List.of(), Map.of(), 0)));
    var nether =
        new ArenaDefinition(
            "pit",
            "Pit",
            "world_nether",
            REGION,
            INSIDE,
            INSIDE,
            OUTSIDE,
            List.of(INSIDE),
            List.of(new Point(20.5, 64, 20.5)),
            Map.of(),
            new BlockPos(6, 64, 5),
            List.of(),
            List.of(),
            1,
            1,
            4);

    assertThat(ArenaContent.check(List.of(arena("colosseum", REGION), nether), classes, 5))
        .isEmpty();
  }
}
