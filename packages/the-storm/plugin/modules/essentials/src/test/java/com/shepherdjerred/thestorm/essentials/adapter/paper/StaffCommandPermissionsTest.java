package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.Proxy;
import java.util.Set;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class StaffCommandPermissionsTest {
  @Test
  void changingAnotherPlayersJailStateRequiresTheCommandSpecificOthersPermission() {
    var actor = sender(Set.of("thestorm.essentials.jail"));
    var target = player();

    assertThatThrownBy(() -> StaffCommands.Request.requireOthers(actor, "jail", target))
        .hasMessage("You do not have permission for that action.");
  }

  @Test
  void aPlayerMayChangeTheirOwnJailStateWithoutOthersPermission() {
    var actor = player(Set.of("thestorm.essentials.jail"));

    StaffCommands.Request.requireOthers(actor, "jail", actor);
  }

  @Test
  void inventoryCommandsRequireOthersPermissionForAnotherPlayer() {
    var actor = player(Set.of("thestorm.essentials.invsee"));
    var target = player();

    assertThatThrownBy(() -> StaffCommands.Request.requireOthers(actor, "invsee", target))
        .hasMessage("You do not have permission for that action.");
    assertThatThrownBy(() -> StaffCommands.Request.requireOthers(actor, "enderchest", target))
        .hasMessage("You do not have permission for that action.");
  }

  @Test
  void inventoryCommandPermissionCanBeRecheckedForAnotherPlayer() {
    var actor = player(Set.of("thestorm.essentials.invsee.others"));
    var target = player();

    assertThat(StaffCommands.Request.allowsOthers(actor, "invsee", target)).isTrue();
    assertThat(StaffCommands.Request.allowsOthers(actor, "enderchest", target)).isFalse();
  }

  @Test
  void aPlayerMayInspectTheirOwnInventoryWithoutOthersPermission() {
    var actor = player(Set.of("thestorm.essentials.invsee"));

    StaffCommands.Request.requireOthers(actor, "invsee", actor);
  }

  private static CommandSender sender(Set<String> permissions) {
    return proxy(CommandSender.class, permissions);
  }

  private static Player player() {
    return player(Set.of());
  }

  private static Player player(Set<String> permissions) {
    return proxy(Player.class, permissions);
  }

  private static <T> T proxy(Class<T> type, Set<String> permissions) {
    return type.cast(
        Proxy.newProxyInstance(
            type.getClassLoader(),
            new Class<?>[] {type},
            (proxy, method, arguments) ->
                switch (method.getName()) {
                  case "hasPermission" -> permissions.contains(arguments[0]);
                  case "equals" ->
                      arguments[0] instanceof Player other
                          && Proxy.isProxyClass(other.getClass())
                          && Proxy.getInvocationHandler(proxy)
                              .equals(Proxy.getInvocationHandler(other));
                  case "hashCode" -> System.identityHashCode(proxy);
                  case "toString" -> "permission-test-proxy";
                  default -> null;
                }));
  }
}
