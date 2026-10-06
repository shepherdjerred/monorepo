package com.shepherdjerred.thestorm.core.world;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import org.bukkit.plugin.Plugin;
import org.bukkit.World;
import org.junit.jupiter.api.Test;

final class ChunkTicketsTest {
  @Test
  void sharedHoldsKeepTheTicketUntilEveryOwnerReleasesIt() {
    var operations = new ArrayList<String>();
    var world =
        (World)
            Proxy.newProxyInstance(
                World.class.getClassLoader(),
                new Class<?>[] {World.class},
                (proxy, method, args) -> {
                  if (method.getName().equals("getName")) return "world";
                  if (method.getName().equals("addPluginChunkTicket")) {
                    operations.add("add");
                    return true;
                  }
                  if (method.getName().equals("removePluginChunkTicket")) {
                    operations.add("remove");
                    return true;
                  }
                  throw new UnsupportedOperationException(method.getName());
                });
    var plugin =
        (Plugin)
            Proxy.newProxyInstance(
                Plugin.class.getClassLoader(),
                new Class<?>[] {Plugin.class},
                (proxy, method, args) -> {
                  throw new UnsupportedOperationException(method.getName());
                });
    var tickets = new ChunkTickets(plugin);

    tickets.hold(world, 4, -2);
    tickets.hold(world, 4, -2);
    assertThat(tickets.holds(world, 4, -2)).isEqualTo(2);
    assertThat(operations).containsExactly("add");

    tickets.release(world, 4, -2);
    assertThat(tickets.holds(world, 4, -2)).isOne();
    assertThat(operations).containsExactly("add");

    tickets.release(world, 4, -2);
    assertThat(tickets.holds(world, 4, -2)).isZero();
    assertThat(operations).containsExactly("add", "remove");
  }
}
