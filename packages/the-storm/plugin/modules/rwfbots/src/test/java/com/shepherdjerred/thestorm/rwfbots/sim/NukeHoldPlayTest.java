package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The training yard's nuke after a defuse. In prod (1020-bf0e, sunspire) lone bots armed and
 * defused one nuke twelve times over five and a half minutes: whoever defused it walked off to its
 * strategy's bomb, and the other side walked back and armed it again.
 */
@Tag("simulation")
final class NukeHoldPlayTest {

  private static final int TICKS = 6000;

  /**
   * The most defuses, one per turn of arm and defuse, over the 108 matches below. Set on
   * e535119dcd: before the nuke's guard 119, with it 81, the longest match 7; the ceiling is that
   * plus the longest match, so one chaotic match cannot flip it. On a4a2b90df6 (the fight and route
   * changes of #4154 to #4179 in) they measure 141 before and 83 with it.
   */
  private static final int MAX_DEFUSES = 88;

  /** A match with this many turns or more is a ping-pong. */
  private static final int PING_PONG = 5;

  /**
   * The most matches that may run to a ping-pong. On a4a2b90df6, 9 before the nuke's guard and 3
   * with it; one match of slack. The longest single run is 11 either way, a lone longbow against a
   * lone longbow: the guard keeps its bow distance (13 to 17 blocks, #4155) instead of stopping the
   * defuse, which nuke handling does not decide. On e535119dcd the longest was 12 before and 7 with
   * the guard.
   */
  private static final int MAX_PING_PONGS = 4;

  /**
   * One match's nuke: how often it was armed, and how often a side armed it again after the other
   * defused it (one turn of the ping-pong).
   */
  record Nuke(
      long seed, int perTeam, Strategy red, Strategy blue, int arms, int defuses, int flips) {}

  static Nuke play(long seed, int perTeam, Strategy red, Strategy blue) {
    var world = Arenas.yard(seed, perTeam, red, blue);
    var nuke =
        world.bombs.values().stream()
            .filter(bomb -> bomb.owner instanceof BombOwner.Nuke)
            .findFirst()
            .orElseThrow();
    var tally = new Tally();
    world.run(
        TICKS,
        w -> {
          tally.observe(nuke);
          return w.winner().isPresent();
        });
    return new Nuke(seed, perTeam, red, blue, tally.arms, tally.defuses, tally.flips);
  }

  /** Counts a nuke's arms and its turns of ping-pong, tick by tick. */
  private static final class Tally {
    int arms;
    int defuses;
    int flips;
    long armedAt = -1;
    long defusedAt = -1;
    Optional<TeamId> armedBy = Optional.empty();
    Optional<TeamId> defusedBy = Optional.empty();

    /** A last bot alive arms in one click, so the tick a fuse was lit marks an arm, not a phase. */
    void observe(SimBomb nuke) {
      if (nuke.armedAtTick != armedAt && nuke.armedBy.isPresent()) {
        armedAt = nuke.armedAtTick;
        arms++;
        var by = nuke.armedBy.orElseThrow();
        if (defusedBy.filter(team -> !team.equals(by)).isPresent()) flips++;
        armedBy = Optional.of(by);
        defusedBy = Optional.empty();
      }
      if (nuke.defusedAtTick != defusedAt) {
        defusedAt = nuke.defusedAtTick;
        defuses++;
        defusedBy = Optional.of(armedBy.orElseThrow().equals(RED) ? BLUE : RED);
      }
    }
  }

  @Test
  void aSideThatDefusesTheNukeHoldsIt() {
    var all = new ArrayList<Nuke>();
    for (var perTeam = 1; perTeam <= 3; perTeam++) {
      for (var seed = 1L; seed <= 12; seed++) {
        for (var sides :
            List.of(
                List.of(Strategy.HUNT, Strategy.RUSH),
                List.of(Strategy.RUSH, Strategy.HUNT),
                List.of(Strategy.HUNT, Strategy.HUNT))) {
          all.add(play(seed, perTeam, sides.get(0), sides.get(1)));
        }
      }
    }
    var defuses = all.stream().mapToInt(Nuke::defuses).sum();
    var pingPongs = all.stream().filter(nuke -> nuke.defuses() >= PING_PONG).count();
    assertThat(defuses).as("arm and defuse cycles over %s", all).isLessThanOrEqualTo(MAX_DEFUSES);
    assertThat(pingPongs).as("ping-pongs among %s", all).isLessThanOrEqualTo(MAX_PING_PONGS);
  }
}
