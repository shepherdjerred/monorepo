package com.shepherdjerred.thestorm.core.players;

import java.util.Optional;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Online players named by an account name or, failing that, by the nickname they display. */
public final class PlayerHandles {

  private PlayerHandles() {}

  /**
   * The online player {@code token} names. An exact account name wins. A nickname resolves only
   * when that player is online; an offline nickname is empty, the same as an unknown name.
   */
  public static Optional<Player> online(
      Server server, Optional<Nicknames> nicknames, String token) {
    var exact = server.getPlayerExact(token);
    if (exact != null) {
      return Optional.of(exact);
    }
    var id = nicknames.flatMap(known -> known.named(token));
    if (id.isEmpty()) {
      return Optional.empty();
    }
    var player = server.getPlayer(id.orElseThrow());
    if (player == null || !player.isOnline()) {
      return Optional.empty();
    }
    return Optional.of(player);
  }

  /** As {@link #online(Server, Optional, String)}, reading nicknames from the server's services. */
  public static Optional<Player> online(Server server, String token) {
    return online(
        server, Optional.ofNullable(server.getServicesManager().load(Nicknames.class)), token);
  }
}
