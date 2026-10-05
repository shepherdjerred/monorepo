package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.LoadedLobby;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyLayout;
import java.util.function.Consumer;
import org.bukkit.Location;

/**
 * The lobby room in the world: its {@link Terrain}, held, verified and pasted like a map, and its
 * layout. Joining, the countdown and a death before the start all put players at its spawn. Main
 * thread only.
 */
final class LobbyRoom {

  private final PaperContext context;
  private final LobbyLayout layout;
  private final Terrain terrain;

  LobbyRoom(PaperContext context, LoadedLobby lobby, ChunkHolder chunks) {
    this.context = context;
    this.layout = lobby.layout();
    this.terrain =
        new Terrain(
            context,
            new Terrain.Source(LoadedLobby.ID, lobby.blocks(), lobby.blocksSha256()),
            chunks);
  }

  LobbyLayout layout() {
    return layout;
  }

  /** Where joining players and arriving bots appear. */
  Location spawn() {
    return Places.location(context.world(), layout.spawn());
  }

  /** Whether {@code location} is inside the room. */
  boolean contains(Location location) {
    return terrain.contains(location);
  }

  /** Whether the room is pasted and verified. */
  boolean ready() {
    return terrain.ready();
  }

  boolean busy() {
    return terrain.busy();
  }

  /** Loads and holds the chunks, then verifies and if need be pastes the room. */
  void prepare(Consumer<Boolean> done) {
    terrain.prepare(done);
  }

  /** Verifies the room and pastes it when it differs; {@code done} gets whether it is ready. */
  void verifyAndRepair(Consumer<Boolean> done) {
    terrain.verifyAndRepair(done);
  }

  /** Lets the chunks go; the module is disabling. */
  void release() {
    terrain.release();
  }
}
