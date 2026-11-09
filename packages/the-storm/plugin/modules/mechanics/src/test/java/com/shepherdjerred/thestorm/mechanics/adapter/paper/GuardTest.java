package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class GuardTest {
  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void historicalGateAuthorityRequiresItsDedicatedOwnerAndEveryCell() {
    var grid = new PaperGrid(MockBukkit.mock().addSimpleWorld("world"));
    var protection = mock(Protection.class);
    when(protection.isPreserved(any())).thenReturn(true);
    when(protection.mayOperateServerHistoricalGate(any()))
        .thenAnswer(call -> ((Location) call.getArgument(0)).getBlockX() == 4);
    var guard = new Guard(protection);
    var approved = List.of(new Pos(4, 64, 4));
    assertThat(guard.gateCells(Protection.SERVER_HISTORICAL_GATE, grid, approved)).isTrue();
    assertThat(guard.gateCells(Protection.SERVER_AUTOMATION, grid, approved)).isFalse();
    assertThat(guard.gateCells(UUID.randomUUID(), grid, approved)).isFalse();
    assertThat(
            guard.gateCells(
                Protection.SERVER_HISTORICAL_GATE,
                grid,
                List.of(approved.getFirst(), new Pos(5, 64, 4))))
        .isFalse();
  }

  @Test
  void ownerEditingRightsCannotAuthorizeAutomaticStructureChanges() {
    var grid = new PaperGrid(MockBukkit.mock().addSimpleWorld("world"));
    var checked = new ArrayList<ProtectedAction>();
    var protection =
        new Protection() {
          @Override
          public Decision check(UUID player, ProtectedAction action, Location at) {
            checked.add(action);
            return switch (action) {
              case AUTOMATIC_BREAK, AUTOMATIC_BUILD ->
                  new Decision.Denied(Component.text("Preserved"));
              default -> Decision.allowed();
            };
          }

          @Override
          public Decision checkHarm(UUID attacker, Location from, HarmTarget target, Location at) {
            return Decision.allowed();
          }

          @Override
          public boolean sameLand(Location a, Location b) {
            return true;
          }

          @Override
          public boolean isPreserved(Location at) {
            return true;
          }
        };
    var guard = new Guard(protection);
    var owner = UUID.randomUUID();
    var cells = List.of(new Pos(4, 64, 4));
    assertThat(guard.cells(owner, grid, cells).isAllowed()).isTrue();
    assertThat(checked).containsExactly(ProtectedAction.BREAK, ProtectedAction.BUILD);
    checked.clear();
    assertThat(guard.automaticCells(owner, grid, cells).isAllowed()).isFalse();
    assertThat(checked).containsExactly(ProtectedAction.AUTOMATIC_BREAK);
  }
}
