package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FrozenWatch;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * ObjectivePlayTest's eight-against-four training-yard matches, watched for frozen bots. Two bots
 * of seed 41 looked stuck: one stood 125 ticks before the jump onto the nuke's dais, one 0.7 blocks
 * short of a walk waypoint beside the blue bomb. Both were clicking the fuse from 2.9 blocks,
 * inside the 3-block reach, while their decision still carried the route to the bomb's approach;
 * the nuke armed at tick 242 and the blue bomb at 780. The watch counts that as work, not as a
 * frozen bot.
 */
@Tag("simulation")
final class FrozenWatchPlayTest {

  @Test
  void noBotStandsFrozenInTheEightAgainstFourYardOpenings() {
    var frozen = new ArrayList<String>();
    var armed = new ArrayList<Long>();
    for (var seed = 40L; seed < 48; seed++) {
      var world = Arenas.yard(seed, 8, Strategy.TURTLE, Strategy.TURTLE);
      world.bodies.values().stream()
          .filter(body -> body.team.equals(BLUE))
          .skip(4)
          .forEach(body -> body.hurt(1000, 0));
      Map<CombatantId, FrozenWatch.State> stillness = new HashMap<>();
      var match = seed;
      world.run(
          801,
          w -> {
            var snapshot = w.snapshot();
            for (var body : w.bodies.values()) {
              if (!body.bot || !body.alive || body.decision.isEmpty()) continue;
              var step =
                  FrozenWatch.observe(
                      stillness.getOrDefault(body.id, FrozenWatch.State.START),
                      snapshot.require(body.id),
                      body.decision.orElseThrow(),
                      snapshot);
              stillness.put(body.id, step.state());
              step.frozen()
                  .ifPresent(
                      ticks ->
                          frozen.add(
                              "seed %d bot %d at %s tick %d: %s"
                                  .formatted(
                                      match,
                                      body.id.value(),
                                      body.pos,
                                      w.tick,
                                      body.decision.orElseThrow().planLabel())));
            }
            return false;
          });
      if (seed == 41) armed.add(world.bomb(2).armedAtTick);
    }
    assertThat(frozen).isEmpty();
    assertThat(armed).as("seed 41's nuke armed by the bots at its dais").allMatch(tick -> tick > 0);
  }
}
