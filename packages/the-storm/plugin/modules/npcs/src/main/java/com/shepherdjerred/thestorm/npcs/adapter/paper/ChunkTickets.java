package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.geo.ChunkKey;
import java.util.HashSet;
import java.util.Set;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;

/**
 * Keeps the chunks NPCs stand in loaded, so NPCs are always present to be reconciled, clicked and
 * walked, even with nobody nearby. Main thread.
 */
public interface ChunkTickets {

  /** Holds exactly {@code chunks}: adds tickets for new ones, releases the rest. */
  void hold(Set<ChunkKey> chunks);

  /** Releases every ticket this holds (other modules' tickets are theirs). */
  default void releaseAll() {
    hold(Set.of());
  }

  /** Plugin chunk tickets. */
  static ChunkTickets paper(Server server, Plugin plugin) {
    return new PaperTickets(server, plugin);
  }

  /** {@link World#addPluginChunkTicket} for each held chunk. */
  final class PaperTickets implements ChunkTickets {

    private final Server server;
    private final Plugin plugin;
    private final Set<ChunkKey> held = new HashSet<>();

    PaperTickets(Server server, Plugin plugin) {
      this.server = server;
      this.plugin = plugin;
    }

    @Override
    public void hold(Set<ChunkKey> chunks) {
      for (var chunk : Set.copyOf(held)) {
        if (!chunks.contains(chunk)) {
          release(chunk);
        }
      }
      for (var chunk : chunks) {
        if (held.add(chunk)) {
          world(chunk).addPluginChunkTicket(chunk.x(), chunk.z(), plugin);
        }
      }
    }

    private void release(ChunkKey chunk) {
      held.remove(chunk);
      var world = server.getWorld(Mannequins.requireKey(chunk.world()));
      if (world != null) {
        world.removePluginChunkTicket(chunk.x(), chunk.z(), plugin);
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
