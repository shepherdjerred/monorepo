package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.RwfHarness;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import java.nio.file.Path;
import java.util.ArrayList;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class MatchRunnerStartupStopTest {
  @TempDir Path directory;

  @Test
  void stoppingBeforeAdmissionStillPublishesTheAcceptedStop() {
    try (var harness = RwfHarness.prepare(directory).enableBeforeLobby(directory)) {
      var runner = (MatchRunner) harness.view();
      assertThat(runner.current()).isEmpty();
      var notifications = new ArrayList<MatchNotification>();
      var subscription = runner.subscribe(notifications::add);
      runner.stop();
      subscription.close();

      assertThat(runner.current()).isEmpty();
      assertThat(notifications).hasSize(1);
      assertThat(notifications.getFirst().event()).isInstanceOf(MatchEvent.Stop.class);
      assertThat(notifications.getFirst().after().phase())
          .isEqualTo(MatchSnapshot.PhaseKind.RESETTING);

      harness.ticks(20);
      assertThat(runner.current()).isEmpty();
      assertThat(runner.match().phase()).isInstanceOf(Phase.Resetting.class);
    }
  }

  @Test
  void permanentStopRestoresCratersAndMembersWithoutStartingSingleMapVerification() {
    try (var harness = RwfHarness.prepare(directory).enable(directory)) {
      var runner = (MatchRunner) harness.view();
      var player = harness.loadedPlayer("Alice");
      harness.goLive(player);
      var map = runner.currentMap().orElseThrow();
      var matchId = runner.match().matchId();
      assertThat(harness.bots.spawned()).isNotEmpty();
      assertThat(map.busy()).isFalse();
      var original = harness.rwf.getBlockAt(0, 64, 0).getBlockData().getAsString();
      map.crater(new BlockPos(0, 64, 0), 1, (_, _) -> {});
      assertThat(map.crateredBlocks()).isPositive();

      runner.stop();

      assertThat(map.busy()).isFalse();
      assertThat(map.crateredBlocks()).isZero();
      assertThat(harness.rwf.getBlockAt(0, 64, 0).getBlockData().getAsString()).isEqualTo(original);
      assertThat(harness.bots.spawned()).isEmpty();
      assertThat(harness.bots.drafted()).isZero();
      harness.until(() -> player.getWorld().equals(harness.overworld));
      assertThat(player.getInventory().contains(Material.DIAMOND, 5)).isTrue();
      assertThat(player.getHealth()).isEqualTo(13);
      harness.ticks(20);
      assertThat(runner.current()).isEmpty();
      assertThat(runner.match().matchId()).isEqualTo(matchId);
      assertThat(runner.match().phase()).isInstanceOf(Phase.Resetting.class);
    }
  }

  @Test
  void ordinaryStopStillVerifiesTheSingleMapBeforeOpeningItsSuccessor() {
    try (var harness = RwfHarness.prepare(directory).enable(directory)) {
      var runner = (MatchRunner) harness.view();
      var map = runner.currentMap().orElseThrow();
      var matchId = runner.match().matchId();
      var original = harness.rwf.getBlockAt(0, 64, 0).getType();
      harness.rwf.getBlockAt(0, 64, 0).setType(Material.GOLD_BLOCK);

      assertThat(runner.handle(new MatchEvent.Stop())).isEmpty();

      assertThat(map.busy()).isTrue();
      harness.until(() -> !runner.match().matchId().equals(matchId));
      assertThat(runner.match().phase()).isInstanceOf(Phase.Lobby.class);
      assertThat(harness.rwf.getBlockAt(0, 64, 0).getType()).isEqualTo(original);
    }
  }

  @Test
  void permanentStopDuringAnOrdinaryVerificationCannotOpenASuccessor() {
    try (var harness = RwfHarness.prepare(directory).enable(directory)) {
      var runner = (MatchRunner) harness.view();
      var map = runner.currentMap().orElseThrow();
      var matchId = runner.match().matchId();
      assertThat(runner.handle(new MatchEvent.Stop())).isEmpty();
      assertThat(map.busy()).isTrue();

      runner.stop();
      harness.until(() -> !map.busy());
      harness.ticks(20);

      assertThat(runner.current()).isEmpty();
      assertThat(runner.match().matchId()).isEqualTo(matchId);
      assertThat(runner.match().phase()).isInstanceOf(Phase.Resetting.class);
    }
  }
}
