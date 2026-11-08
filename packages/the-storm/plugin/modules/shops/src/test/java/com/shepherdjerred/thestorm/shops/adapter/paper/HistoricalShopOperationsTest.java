package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class HistoricalShopOperationsTest {
  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server
        .getPluginManager()
        .addPermission(new Permission(ShopsPermissions.ADMIN, PermissionDefault.FALSE));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void theServerConsoleCanRunTheOneTimeOperation() {
    assertThat(HistoricalShopOperations.mayRestore(server.getConsoleSender())).isTrue();
  }

  @Test
  void beingAnOpDoesNotGrantAPlayerTheRestorationCapability() {
    var player = server.addPlayer();
    player.setOp(true);
    assertThat(HistoricalShopOperations.mayRestore(player)).isFalse();
    player.addAttachment(MockBukkit.createMockPlugin(), ShopsPermissions.ADMIN, true);
    assertThat(HistoricalShopOperations.mayRestore(player)).isTrue();
  }
}
