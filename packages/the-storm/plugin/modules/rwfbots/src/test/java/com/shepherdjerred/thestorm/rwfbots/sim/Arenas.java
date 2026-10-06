package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
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

  /** {@code perTeam} bots a side on the training yard, from its spawns, bombs and nuke. */
  static SimWorld yard(long seed, int perTeam, Strategy red, Strategy blue) {
    return yard(seed, new Lineup(perTeam, red, blue, Set.of()));
  }

  record Lineup(int perTeam, Strategy red, Strategy blue, Set<Archetype> late) {}

  /** The same lineup with opening pauses for the selected archetypes. */
  static SimWorld yard(long seed, Lineup lineup) {
    var world = new SimWorld(YARD, seed);
    var id = 0;
    for (var bomb : YARD.sites().bombs()) {
      if (bomb.team().isPresent()) {
        world.addBomb(id++, new TeamId(bomb.team().orElseThrow()), bomb.cell());
      } else {
        world.addNuke(id++, bomb.cell());
      }
    }
    var bot = 1;
    for (var team : List.of(RED, BLUE)) {
      var spawns =
          YARD.sites().spawns().stream()
              .filter(site -> site.team().orElseThrow().equals(team.value()))
              .sorted(Comparator.comparing(site -> site.name()))
              .toList();
      for (var i = 0; i < lineup.perTeam(); i++) {
        var pick = EIGHT.get(i % EIGHT.size());
        add(
            world,
            new SimWorld.Spawn(bot++, team, pick.kit(), spawns.get(i).cell().feet()),
            pick,
            lineup.late().contains(pick.archetype()) ? Set.of(Quirk.LATE_TO_EVERYTHING) : Set.of());
      }
    }
    world.setStrategy(RED, lineup.red());
    world.setStrategy(BLUE, lineup.blue());
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
    add(world, spawn, pick, Set.of());
  }

  private static void add(SimWorld world, SimWorld.Spawn spawn, Pick pick, Set<Quirk> quirks) {
    var archetype = pick.archetype();
    var levers =
        LeverCurves.at(0.65, LeverOffsets.NONE.plus(Lever.AGGRESSION, archetype.aggressionZ()));
    var aggression = Math.clamp(0.5 + 0.2 * archetype.aggressionZ(), 0, 1);
    world.addBot(
        spawn,
        new SimWorld.Persona(levers, new Style(aggression, 0.5, 0.6, 0.5), archetype, quirks));
  }
}
