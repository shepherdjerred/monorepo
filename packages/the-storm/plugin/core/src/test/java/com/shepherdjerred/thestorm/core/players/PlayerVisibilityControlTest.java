package com.shepherdjerred.thestorm.core.players;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Entity;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class PlayerVisibilityControlTest {
  private static final class RecordingPlayer extends PlayerMock {
    private final List<UUID> shown = new ArrayList<>();

    RecordingPlayer(ServerMock server, String name) {
      super(server, name);
    }

    @Override
    public void showEntity(Plugin plugin, Entity entity) {
      shown.add(entity.getUniqueId());
      super.showEntity(plugin, entity);
    }
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void independentReasonsAndReleaseOrderNeverRevealAnotherOwnersHide() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin();
    var viewer = server.addPlayer("viewer");
    var target = server.addPlayer("target");
    try (var visibility = new PlayerVisibilityControl(plugin)) {
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.COMBAT, true);
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.STAFF, false);
      assertThat(viewer.canSee(target)).isFalse();
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.STAFF, true);
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.SPECTATOR, true);
      visibility.release(PlayerVisibilityControl.Reason.COMBAT);
      visibility.release(PlayerVisibilityControl.Reason.STAFF);
      assertThat(viewer.canSee(target)).isFalse();
      visibility.release(PlayerVisibilityControl.Reason.SPECTATOR);
      assertThat(viewer.canSee(target)).isTrue();
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.STAFF, true);
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.COMBAT, true);
      visibility.release(PlayerVisibilityControl.Reason.COMBAT);
      assertThat(viewer.canSee(target)).isFalse();
    }
    assertThat(viewer.canSee(target)).isTrue();
  }

  @Test
  void quitDiscardsBothSidesWithoutShowingTheDepartingPlayerOrClearingUnrelatedPairs() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin();
    var viewer = new RecordingPlayer(server, "viewer");
    var target = new RecordingPlayer(server, "target");
    server.addPlayer(viewer);
    server.addPlayer(target);
    var other = server.addPlayer("other");
    try (var visibility = new PlayerVisibilityControl(plugin)) {
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.COMBAT, true);
      visibility.set(target, viewer, PlayerVisibilityControl.Reason.COMBAT, true);
      visibility.set(viewer, other, PlayerVisibilityControl.Reason.STAFF, true);
      server
          .getPluginManager()
          .callEvent(
              new PlayerQuitEvent(
                  target, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
      assertThat(viewer.shown).isEmpty();
      assertThat(target.shown).isEmpty();
      assertThat(viewer.canSee(other)).isFalse();
      visibility.set(viewer, target, PlayerVisibilityControl.Reason.STAFF, false);
      visibility.release(PlayerVisibilityControl.Reason.COMBAT);
      assertThat(viewer.shown).isEmpty();
      assertThat(target.shown).isEmpty();
    }
    assertThat(viewer.shown).containsExactly(other.getUniqueId());
    assertThat(target.shown).isEmpty();
  }

  @Test
  void pluginDisableAndClosePreserveAnotherPluginsHide() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin("storm");
    var other = MockBukkit.createMockPlugin("other");
    var viewer = server.addPlayer("viewer");
    var target = server.addPlayer("target");
    var visibility = new PlayerVisibilityControl(plugin);
    visibility.set(viewer, target, PlayerVisibilityControl.Reason.STAFF, true);
    visibility.set(target, viewer, PlayerVisibilityControl.Reason.SPECTATOR, true);
    viewer.hideEntity(other, target);
    server.getPluginManager().callEvent(new PluginDisableEvent(plugin));
    visibility.close();
    visibility.release(PlayerVisibilityControl.Reason.STAFF);
    visibility.set(target, viewer, PlayerVisibilityControl.Reason.SPECTATOR, false);
    assertThat(viewer.canSee(target)).isFalse();
    assertThat(target.canSee(viewer)).isTrue();
    viewer.showEntity(other, target);
    assertThat(viewer.canSee(target)).isTrue();
    assertThatThrownBy(
            () -> visibility.set(viewer, target, PlayerVisibilityControl.Reason.COMBAT, true))
        .isInstanceOf(IllegalStateException.class);
  }
}
