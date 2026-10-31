package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.team.Playbook;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Whether a team keeps someone home on the shipped maps where prod teams left their bomb bare: in
 * prod (tsmc, Oct 18-23) six teams had a teammate within {@link Playbook#HOME_RANGE} blocks of
 * their own bomb less than 40% of the time (miner-dispute red 0.02, hemispheres blue 0.12), their
 * anchors holding cover 13 to 25 blocks out.
 */
@Tag("simulation")
final class HomeGuardPlayTest {

  /** Where the first anchor is checked: every shipped map the sim loads. */
  private static final List<String> DEALT =
      List.of(
          "the-harshest-harvest",
          "miner-dispute",
          "cloned-balance",
          "hemispheres",
          "floating-isles",
          "valley");

  /**
   * Where whole matches are played. The-harshest-harvest is left out: red's bomb stands on a tower
   * reached by a ladder, and the sim's bodies do not climb.
   */
  private static final List<String> PLAYED =
      List.of("miner-dispute", "hemispheres", "floating-isles");

  private static final int TICKS = 2400;

  /** How often a match is sampled, in ticks. */
  private static final int SAMPLE = 20;

  /**
   * The least pooled share of samples with a guard home over the matches below. Main (fff838f668)
   * measures 1538 of 2880 (0.534) on exactly these 24 team-matches, hemispheres teams 0.00 to 0.50;
   * the home anchor measures 2490 of 2866 (0.869). The floor is that with its best team-match (118
   * guarded) counted as never guarded, 0.828, so one chaotic match cannot flip it.
   */
  private static final double GUARDED_SHARE = 0.82;

  /** One team's match: samples with its bomb standing, and how many of those had a guard home. */
  record Coverage(String map, long seed, TeamId team, int samples, int guarded) {
    double share() {
      return samples == 0 ? 1 : guarded / (double) samples;
    }
  }

  private static SimWorld world(String map, long seed) {
    return Arenas.shipped(
        Arenas.shippedNav(map),
        seed,
        12,
        new Arenas.Sides(
            new Arenas.Lineup(Strategy.RUSH, Arenas.EIGHT),
            new Arenas.Lineup(Strategy.SPLIT, Arenas.EIGHT)));
  }

  private static Optional<SimBomb> ownBomb(SimWorld world, TeamId team) {
    return world.bombs.values().stream()
        .filter(bomb -> bomb.owner instanceof BombOwner.Team && bomb.owner.isTeam(team))
        .findFirst();
  }

  private static List<Coverage> play(String map, long seed) {
    var world = world(map, seed);
    var teams = List.of(RED, BLUE);
    var samples = new int[teams.size()];
    var guarded = new int[teams.size()];
    world.run(
        TICKS,
        w -> {
          for (var i = 0; w.tick % SAMPLE == 0 && i < teams.size(); i++) {
            var home = guardedHome(w, teams.get(i));
            if (home.isPresent()) {
              samples[i]++;
              guarded[i] += home.orElseThrow() ? 1 : 0;
            }
          }
          return w.winner().isPresent();
        });
    var out = new ArrayList<Coverage>();
    for (var i = 0; i < teams.size(); i++) {
      out.add(new Coverage(map, seed, teams.get(i), samples[i], guarded[i]));
    }
    return out;
  }

  /**
   * Whether a living member of {@code team} stands within {@link Playbook#HOME_RANGE} of its bomb;
   * empty once the bomb or the team is gone.
   */
  private static Optional<Boolean> guardedHome(SimWorld world, TeamId team) {
    var bomb = ownBomb(world, team).filter(standing -> !standing.exploded());
    var members =
        world.bodies.values().stream()
            .filter(body -> body.alive && body.team.equals(team))
            .toList();
    if (bomb.isEmpty() || members.isEmpty()) return Optional.empty();
    var at = bomb.orElseThrow().pos;
    return Optional.of(
        members.stream().anyMatch(body -> body.pos.distance(at) <= Playbook.HOME_RANGE));
  }

  @Test
  void theFirstAnchorStandsWithinRangeOfTheOwnBombOnEveryShippedMap() {
    for (var map : DEALT) {
      var world = world(map, 1);
      world.step();
      for (var team : List.of(RED, BLUE)) {
        var bomb = ownBomb(world, team).orElseThrow();
        var first =
            world.boards.get(team).plan().slots().stream()
                .filter(slot -> slot.key().equals("anchor-0"))
                .findFirst();
        assertThat(first).as("%s %s deals an anchor", map, team.value()).isPresent();
        assertThat(first.orElseThrow().pos().distance(bomb.pos))
            .as("%s %s first anchor from its bomb", map, team.value())
            .isLessThanOrEqualTo(Playbook.HOME_RANGE);
      }
    }
  }

  @Test
  void teamsKeepAGuardHomeOnTheMapsProdLeftBare() {
    var all = new ArrayList<Coverage>();
    for (var map : PLAYED) {
      for (var seed = 1L; seed <= 4; seed++) {
        all.addAll(play(map, seed));
      }
    }
    var samples = all.stream().mapToInt(Coverage::samples).sum();
    var guarded = all.stream().mapToInt(Coverage::guarded).sum();
    assertThat(guarded / (double) samples)
        .as("share of %d samples with a guard home: %s", samples, all)
        .isGreaterThanOrEqualTo(GUARDED_SHARE);
  }
}
