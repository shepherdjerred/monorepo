package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.npcs.domain.geo.ChunkKey;
import java.util.HashSet;
import java.util.Set;
import org.bukkit.Server;
import org.bukkit.World;

/**
 * The chunks NPCs stand in, kept loaded so NPCs are always present to be reconciled, clicked and
 * walked, even with nobody nearby. Main thread.
 */
public interface HeldChunks {

  /** Holds exactly {@code chunks}: takes holds on new ones, releases the rest. */
  void hold(Set<ChunkKey> chunks);

  /** Releases every hold this has taken. */
  default void releaseAll() {
    hold(Set.of());
  }

  /** Holds through core's shared, reference-counted {@link ChunkTickets}. */
  static HeldChunks paper(Server server, ChunkTickets tickets) {
    return new Shared(server, tickets);
  }

  /** One hold per chunk on the shared tickets, so other modules' holds are never dropped. */
  final class Shared implements HeldChunks {

    private final Server server;
    private final ChunkTickets tickets;
    private final Set<ChunkKey> held = new HashSet<>();

    Shared(Server server, ChunkTickets tickets) {
      this.server = server;
      this.tickets = tickets;
    }

    @Override
    public void hold(Set<ChunkKey> chunks) {
      for (var chunk : Set.copyOf(held)) {
        if (!chunks.contains(chunk)) {
          held.remove(chunk);
          tickets.release(world(chunk), chunk.x(), chunk.z());
        }
      }
      for (var chunk : chunks) {
        if (!held.contains(chunk)) {
          tickets.hold(world(chunk), chunk.x(), chunk.z());
          held.add(chunk);
        }
      }
    }

    private World world(ChunkKey chunk) {
      var world = server.getWorld(Mannequins.requireKey(chunk.world()));
      if (world == null) {
        throw new IllegalStateException("world " + chunk.world() + " is not loaded");
      }
      return world;
    }
  }
}
