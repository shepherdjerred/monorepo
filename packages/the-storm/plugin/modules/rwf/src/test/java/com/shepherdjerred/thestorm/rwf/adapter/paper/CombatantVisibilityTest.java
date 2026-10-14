package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl;
import com.shepherdjerred.thestorm.rwf.app.SmokeFields;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class CombatantVisibilityTest {
  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void removingOneHideReasonDoesNotRevealThroughTheOtherAndNewViewersAreReconciled() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin();
    var viewer = server.addPlayer("viewer");
    var target = server.addPlayer("target");
    var kitHidden = new AtomicBoolean(true);
    var smoke = new SmokeFields();
    var point = new Point(0, 0, 0);
    smoke.add(new SmokeFields.Field(target.getUniqueId(), point, 4, Instant.EPOCH.plusSeconds(6)));
    var visibility =
        new CombatantVisibility(
            new PlayerVisibilityControl(plugin),
            (from, to) -> kitHidden.get() || smoke.obscured(point, point));
    visibility.refresh(List.of(viewer), List.of(target));
    assertThat(viewer.canSee(target)).isFalse();
    kitHidden.set(false);
    visibility.refresh(List.of(viewer), List.of(target));
    assertThat(viewer.canSee(target)).isFalse();
    var newcomer = server.addPlayer("newcomer");
    visibility.refresh(List.of(viewer, newcomer), List.of(target));
    assertThat(newcomer.canSee(target)).isFalse();
    smoke.clear();
    kitHidden.set(true);
    visibility.refresh(List.of(viewer, newcomer), List.of(target));
    assertThat(viewer.canSee(target)).isFalse();
    kitHidden.set(false);
    visibility.refresh(List.of(viewer, newcomer), List.of(target));
    assertThat(viewer.canSee(target)).isTrue();
    assertThat(newcomer.canSee(target)).isTrue();
  }

  @Test
  void twoOwnersSmokeOutlivesTheFirstFieldAndStaffSweepCannotRevealEitherDirection() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin();
    var first = server.addPlayer("first");
    var second = server.addPlayer("second");
    var smoke = new SmokeFields();
    var point = new Point(0, 0, 0);
    smoke.add(new SmokeFields.Field(first.getUniqueId(), point, 4, Instant.EPOCH.plusSeconds(6)));
    smoke.add(new SmokeFields.Field(second.getUniqueId(), point, 4, Instant.EPOCH.plusSeconds(8)));
    try (var control = new PlayerVisibilityControl(plugin)) {
      var visibility = new CombatantVisibility(control, (from, to) -> smoke.obscured(point, point));
      var players = List.<org.bukkit.entity.Player>of(first, second);
      visibility.refresh(players, players);
      control.set(first, second, PlayerVisibilityControl.Reason.STAFF, false);
      control.set(second, first, PlayerVisibilityControl.Reason.STAFF, false);
      smoke.expire(Instant.EPOCH.plusMillis(6500));
      visibility.refresh(players, players);
      assertThat(first.canSee(second)).isFalse();
      assertThat(second.canSee(first)).isFalse();
      control.set(first, second, PlayerVisibilityControl.Reason.STAFF, true);
      smoke.expire(Instant.EPOCH.plusSeconds(9));
      visibility.refresh(players, players);
      assertThat(first.canSee(second)).isFalse();
      assertThat(second.canSee(first)).isTrue();
      control.release(PlayerVisibilityControl.Reason.STAFF);
      assertThat(first.canSee(second)).isTrue();
      assertThat(visibility.active()).isFalse();
    }
  }

  @Test
  void leaveAndResetRestoreOnlyThisPluginsVisibility() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin("visibility");
    var other = MockBukkit.createMockPlugin("other");
    var viewer = server.addPlayer("viewer");
    var target = server.addPlayer("target");
    var visibility =
        new CombatantVisibility(new PlayerVisibilityControl(plugin), (from, to) -> true);
    visibility.refresh(List.of(viewer), List.of(target));
    visibility.clear(target);
    assertThat(viewer.canSee(target)).isTrue();
    visibility.refresh(List.of(viewer), List.of(target));
    viewer.hideEntity(other, target);
    visibility.reset();
    assertThat(viewer.canSee(target)).isFalse();
    viewer.showEntity(other, target);
    assertThat(viewer.canSee(target)).isTrue();
    assertThat(visibility.active()).isFalse();
  }
}
