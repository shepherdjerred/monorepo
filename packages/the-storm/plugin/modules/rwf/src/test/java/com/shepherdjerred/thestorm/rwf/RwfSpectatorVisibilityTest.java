package com.shepherdjerred.thestorm.rwf;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class RwfSpectatorVisibilityTest {
  @TempDir Path directory;

  @Test
  void successiveDeathsLetSpectatorsSeeEachOtherWithoutReleasingStaffHides() {
    try (var harness = RwfHarness.prepare(directory)) {
      harness.features =
          new RwfFeatures(false, false, false, false, true, false, false, false, false);
      harness.enable(directory);
      var first = harness.loadedPlayer("First");
      var second = harness.loadedPlayer("Second");
      var living = harness.loadedPlayer("Living");
      harness.enter(first);
      harness.enter(second);
      harness.goLive(living);

      first.setHealth(0);
      harness.until(() -> !harness.combatant(first).alive());
      first.respawn();
      harness.until(first::isFlying);
      assertThat(second.canSee(first)).isFalse();
      assertThat(living.canSee(first)).isFalse();

      var visibility = harness.services.require(PlayerVisibilityControl.class);
      visibility.set(second, first, PlayerVisibilityControl.Reason.STAFF, true);
      second.setHealth(0);
      harness.until(() -> !harness.combatant(second).alive());
      second.respawn();
      harness.until(second::isFlying);
      // The spectator reconciler runs every twenty scheduler ticks, not every elapsed second.
      harness.ticks(20);

      assertThat(first.canSee(second)).isTrue();
      assertThat(second.canSee(first)).isFalse();
      assertThat(living.canSee(first)).isFalse();
      assertThat(living.canSee(second)).isFalse();
      visibility.release(PlayerVisibilityControl.Reason.STAFF);
      assertThat(second.canSee(first)).isTrue();
    }
  }
}
