package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import org.bukkit.command.BlockCommandSender;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ProxiedCommandSender;
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
    player.addAttachment(MockBukkit.createMockPlugin(), ShopsPermissions.RESTORE, true);
    assertThat(HistoricalShopOperations.mayRestore(player)).isFalse();
    player.addAttachment(MockBukkit.createMockPlugin(), ShopsPermissions.ADMIN, true);
    assertThat(HistoricalShopOperations.mayRestore(player)).isTrue();
  }

  @Test
  void capturedOperatorSendersUseTheRestorationPermission() {
    assertThat(HistoricalShopOperations.mayRestore(sender(CommandSender.class, true))).isTrue();
    assertThat(HistoricalShopOperations.mayRestore(sender(CommandSender.class, false))).isFalse();
    assertThat(HistoricalShopOperations.mayRestore(sender(BlockCommandSender.class, true)))
        .isFalse();
  }

  @Test
  void proxyExecutionRetainsTheOriginalCallersAuthority() {
    var player = server.addPlayer();
    player.setOp(true);
    assertThat(HistoricalShopOperations.mayRestore(proxy(player))).isFalse();
    assertThat(HistoricalShopOperations.mayRestore(proxy(server.getConsoleSender()))).isTrue();
  }

  private static ProxiedCommandSender proxy(CommandSender caller) {
    return (ProxiedCommandSender)
        Proxy.newProxyInstance(
            ProxiedCommandSender.class.getClassLoader(),
            new Class<?>[] {ProxiedCommandSender.class},
            (_, method, _) -> {
              if (method.getName().equals("getCaller")) return caller;
              throw new UnsupportedOperationException(method.getName());
            });
  }

  private static CommandSender sender(Class<? extends CommandSender> type, boolean permitted) {
    return (CommandSender)
        Proxy.newProxyInstance(
            type.getClassLoader(),
            new Class<?>[] {type},
            (_, method, args) -> {
              if (method.getName().equals("hasPermission"))
                return permitted && ShopsPermissions.RESTORE.equals(args[0]);
              throw new UnsupportedOperationException(method.getName());
            });
  }
}
