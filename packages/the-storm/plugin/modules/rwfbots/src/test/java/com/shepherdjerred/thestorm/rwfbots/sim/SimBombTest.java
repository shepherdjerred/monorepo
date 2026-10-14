package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.*;
import org.junit.jupiter.api.Test;

final class SimBombTest {
  @Test
  void armedNukeRetainsItsTeamAndOpponentsCanFinishDefusingIt() {
    var bomb = new SimBomb(new BombId(0), new BombOwner.Nuke(), Vec3.ZERO);
    bomb.click(new CombatantId(1), RED, 0, true);
    assertThat(bomb.view().threatens(BLUE)).isTrue();
    assertThat(bomb.view().threatens(RED)).isFalse();
    for (var tick = 1; tick <= 180; tick++) {
      if (tick % 10 == 1) bomb.click(new CombatantId(2), BLUE, tick, false);
      bomb.tick(tick);
    }
    assertThat(bomb.defusedAtTick).isEqualTo(180);
    assertThat(bomb.view().state()).isInstanceOf(BombState.Idle.class);
    assertThat(bomb.view().threatens(BLUE)).isFalse();
  }
}
