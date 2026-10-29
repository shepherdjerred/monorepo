package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/** Full matches for the headless sim: the shipped training yard and the synthetic arena. */
final class Arenas {

  /** The training yard's shipped nav artifact (64 by 64, two bases, pillars, a central nuke). */
  static final NavArtifact YARD = TrainingYardNav.NAV;

  static final NavArtifact SYNTHETIC = SyntheticMap.bake();

  /**
   * One bot of a lineup.
   *
   * @param archetype who it is
   * @param kit what it plays
   */
  record Pick(Archetype archetype, Kit kit) {}

  record Lineup(Strategy strategy, List<Pick> picks) {}

  /** Both teams' lineups. */
  record Sides(Lineup red, Lineup blue) {}

  /** An eight-strong lineup spread over the archetypes and the four shipped kits. */
  static final List<Pick> EIGHT =
      List.of(
          new Pick(Archetype.RUSHER, Kit.TROOPER),
          new Pick(Archetype.SNIPER, Kit.LONGBOW),
          new Pick(Archetype.BOMB_DIVER, Kit.TROOPER),
          new Pick(Archetype.ANCHOR, Kit.TROOPER),
          new Pick(Archetype.FLANKER, Kit.SHORTBOW),
          new Pick(Archetype.SUPPORT, Kit.TROOPER),
          new Pick(Archetype.DUELIST, Kit.TROOPER),
          new Pick(Archetype.HUNTER, Kit.REWIND));

  private Arenas() {}

  /** A shipped map's baked nav artifact, as the stuck-spot regressions load it. */
  static NavArtifact shippedNav(String map) {
    var path = Path.of(System.getProperty("thestorm.rwfbots.shippedMaps"), map, "nav.rwfnav");
    try {
      return switch (NavCodec.decode(Files.readAllBytes(path))) {
        case Result.Ok<NavArtifact, NavCodec.CodecError>(var nav) -> nav;
        case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
            throw new IllegalStateException(map + " nav does not decode: " + error);
      };
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** {@code perTeam} bots a side on the training yard, from its spawns, bombs and nuke. */
  static SimWorld yard(long seed, int perTeam, Strategy red, Strategy blue) {
    return yard(seed, perTeam, new Lineup(red, EIGHT), new Lineup(blue, EIGHT));
  }

  /** The same authored yard and physics, with explicit team cohorts. */
  static SimWorld yard(long seed, int perTeam, Lineup red, Lineup blue) {
    return shipped(YARD, seed, perTeam, new Sides(red, blue));
  }

  /**
   * {@code perTeam} bots a side on a shipped map, from its baked spawns, bombs and nukes; teams
   * larger than a side's spawn sites share them in turn.
   */
  static SimWorld shipped(NavArtifact nav, long seed, int perTeam, Sides sides) {
    var red = sides.red();
    var blue = sides.blue();
    if (red.picks().isEmpty() || blue.picks().isEmpty()) {
      throw new IllegalArgumentException("both teams need a nonempty cohort");
    }
    var world = new SimWorld(nav, seed);
    var id = 0;
    for (var bomb : nav.sites().bombs()) {
      if (bomb.team().isPresent()) {
        world.addBomb(id++, new TeamId(bomb.team().orElseThrow()), bomb.cell());
      } else {
        world.addNuke(id++, bomb.cell());
      }
    }
    var bot = 1;
    for (var team : List.of(RED, BLUE)) {
      var cohort = team.equals(RED) ? red.picks() : blue.picks();
      var spawns =
          nav.sites().spawns().stream()
              .filter(site -> site.team().orElseThrow().equals(team.value()))
              .sorted(Comparator.comparing(site -> site.name()))
              .toList();
      if (spawns.isEmpty()) {
        throw new IllegalArgumentException(nav.mapId() + " has no " + team.value() + " spawn");
      }
      for (var i = 0; i < perTeam; i++) {
        var pick = cohort.get(i % cohort.size());
        var at = spawns.get(i % spawns.size()).cell().feet();
        add(world, new SimWorld.Spawn(bot++, team, pick.kit(), at), pick);
      }
    }
    world.setStrategy(RED, red.strategy());
    world.setStrategy(BLUE, blue.strategy());
    return world;
  }

  /** {@code perTeam} bots a side on the synthetic arena, on a three-block grid at each spawn. */
  static SimWorld synthetic(long seed, int perTeam, Strategy red, Strategy blue) {
    var world = new SimWorld(SYNTHETIC, seed);
    world.addBomb(0, RED, SyntheticMap.RED_BOMB);
    world.addBomb(1, BLUE, SyntheticMap.BLUE_BOMB);
    var bot = 1;
    for (var i = 0; i < perTeam; i++) {
      var pick = EIGHT.get(i % EIGHT.size());
      var redAt = SyntheticMap.RED_SPAWN.offset(3 * (i % 2), 0, 3 * (i / 2)).feet();
      var blueAt = SyntheticMap.BLUE_SPAWN.offset(-3 * (i % 2), 0, -3 * (i / 2)).feet();
      add(world, new SimWorld.Spawn(bot++, RED, pick.kit(), redAt), pick);
      add(world, new SimWorld.Spawn(bot++, BLUE, pick.kit(), blueAt), pick);
    }
    world.setStrategy(RED, red);
    world.setStrategy(BLUE, blue);
    return world;
  }

  private static void add(SimWorld world, SimWorld.Spawn spawn, Pick pick) {
    var archetype = pick.archetype();
    var levers =
        LeverCurves.at(0.65, LeverOffsets.NONE.plus(Lever.AGGRESSION, archetype.aggressionZ()));
    var aggression = Math.clamp(0.5 + 0.2 * archetype.aggressionZ(), 0, 1);
    world.addBot(
        spawn,
        new SimWorld.Persona(
            levers, new Style(aggression, 0.5, 0.6, 0.5), archetype, Set.<Quirk>of()));
  }
}
