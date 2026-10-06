package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

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
