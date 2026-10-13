package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** The Paper showcase's per-round, all-eight forward floor, including defensive strategies. */
final class WholeRosterAdvanceTest {

  private static final long BY_TICK = 200;
  private static final double THIRD = 20;
  private static final double MIN_FORWARD = 0.25;

  // Preserve EIGHT's archetypes and skill; change only the three additional ranged kits.
  private static final List<Arenas.Pick> RANGED_HEAVY =
      List.of(
          new Arenas.Pick(Archetype.RUSHER, Kit.TROOPER),
          new Arenas.Pick(Archetype.SNIPER, Kit.LONGBOW),
          new Arenas.Pick(Archetype.BOMB_DIVER, Kit.TROOPER),
          new Arenas.Pick(Archetype.ANCHOR, Kit.LONGBOW),
          new Arenas.Pick(Archetype.FLANKER, Kit.SHORTBOW),
          new Arenas.Pick(Archetype.SUPPORT, Kit.SHORTBOW),
          new Arenas.Pick(Archetype.DUELIST, Kit.SHORTBOW),
          new Arenas.Pick(Archetype.HUNTER, Kit.REWIND));

  private record Matchup(long seed, Strategy red, Strategy blue) {}

  private enum Cohort {
    MIXED,
    RANGED_HEAVY
  }

  private record CohortMatchup(Matchup match, Cohort red, Cohort blue) {}

  private static Stream<Matchup> matchups() {
    // The preserved Paper diagnostic used the final seed with TURTLE against RUSH.
    // These are deterministic sim draws, not a reconstruction of its different personalities.
    return Stream.of(10L, 11L, 1922958427992948195L)
        .flatMap(
            seed ->
                Stream.of(
                    new Matchup(seed, Strategy.TURTLE, Strategy.RUSH),
                    new Matchup(seed, Strategy.RUSH, Strategy.TURTLE),
                    new Matchup(seed, Strategy.TURTLE, Strategy.TURTLE)));
  }

  @MethodSource("matchups")
  @ParameterizedTest(name = "{0}")
  void eachWholeRosterCrossesItsOwnThirdBeforeTickTwoHundred(Matchup matchup) {
    var world = Arenas.yard(matchup.seed(), 8, matchup.red(), matchup.blue());
    expectWholeRosterAdvance(world, matchup);
  }

  private static Stream<CohortMatchup> rangedMatchups() {
    return matchups()
        .flatMap(
            match ->
                Stream.of(
                    new CohortMatchup(match, Cohort.RANGED_HEAVY, Cohort.MIXED),
                    new CohortMatchup(match, Cohort.MIXED, Cohort.RANGED_HEAVY),
                    new CohortMatchup(match, Cohort.RANGED_HEAVY, Cohort.RANGED_HEAVY)));
  }

  @MethodSource("rangedMatchups")
  @ParameterizedTest(name = "{0}")
  void rangedHeavyWholeRostersMeetTheSameOpeningFloor(CohortMatchup matchup) {
    var match = matchup.match();
    var world =
        Arenas.yard(
            match.seed(),
            8,
            new Arenas.Lineup(match.red(), cohort(matchup.red())),
            new Arenas.Lineup(match.blue(), cohort(matchup.blue())));
    expectWholeRosterAdvance(world, matchup);
  }

  private static List<Arenas.Pick> cohort(Cohort cohort) {
    return switch (cohort) {
      case MIXED -> Arenas.EIGHT;
      case RANGED_HEAVY -> RANGED_HEAVY;
    };
  }

  private static void expectWholeRosterAdvance(SimWorld world, Object matchup) {
    var opening = new Opening(world);
    // Capture spawn positions at tick zero, then every living position at ticks 1..199.
    // Unlike Advance.forwardBy, this neither excludes anchors nor averages different rounds.
    world.run(
        (int) BY_TICK,
        state -> {
          opening.observe();
          return false;
        });

    for (var team : List.of(RED, BLUE)) {
      assertThat(opening.share(team))
          .as("%s %s whole-roster forward before tick 200%n%s", matchup, team, opening.details())
          .isGreaterThanOrEqualTo(MIN_FORWARD);
    }
  }

  /** Measures the same absolute x displacement and fixed roster denominator as rwf-trails.ts. */
  private static final class Opening {
    private final SimWorld world;
    private final Map<CombatantId, Vec3> starts = new LinkedHashMap<>();
    private final Map<CombatantId, Double> furthest = new LinkedHashMap<>();
    private final Map<CombatantId, Long> firstCrossing = new LinkedHashMap<>();
    private final Map<CombatantId, Long> deaths = new LinkedHashMap<>();

    Opening(SimWorld world) {
      this.world = world;
      world.bodies.values().forEach(body -> starts.put(body.id, body.pos));
    }

    void observe() {
      for (var body : world.bodies.values()) {
        if (!body.alive) {
          deaths.putIfAbsent(body.id, world.tick);
          continue;
        }
        var distance = Math.abs(body.pos.x() - starts.get(body.id).x());
        furthest.merge(body.id, distance, Math::max);
        if (distance >= THIRD) {
          firstCrossing.putIfAbsent(body.id, world.tick);
        }
      }
    }

    double share(TeamId team) {
      var members = world.bodies.values().stream().filter(body -> body.team.equals(team)).toList();
      var crossed =
          members.stream().filter(body -> furthest.getOrDefault(body.id, 0.0) >= THIRD).count();
      return (double) crossed / members.size();
    }

    String details() {
      var lines = new ArrayList<String>();
      for (var body : world.bodies.values()) {
        lines.add(
            body.id
                + " "
                + body.team
                + " "
                + body.kit
                + " maxDx "
                + furthest.getOrDefault(body.id, 0.0)
                + " firstCross "
                + firstCrossing.get(body.id)
                + " death "
                + deaths.get(body.id)
                + " position "
                + body.pos
                + " plan "
                + body.decision.map(decision -> decision.planLabel()).orElse("none"));
      }
      return String.join("\n", lines);
    }
  }
}
