package com.shepherdjerred.thestorm.discord;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class PlayerVisibilityTest {

  @Test
  void hidesPlayersWithVanishMetadata() {
    assertThat(PlayerVisibility.isPublic(playerWithMetadata(true))).isFalse();
    assertThat(PlayerVisibility.isPublic(playerWithMetadata(false))).isTrue();
  }

  private static Player playerWithMetadata(boolean vanished) {
    return (Player)
        Proxy.newProxyInstance(
            Player.class.getClassLoader(),
            new Class<?>[] {Player.class},
            (_, method, _) -> method.getName().equals("hasMetadata") ? vanished : null);
  }
}
