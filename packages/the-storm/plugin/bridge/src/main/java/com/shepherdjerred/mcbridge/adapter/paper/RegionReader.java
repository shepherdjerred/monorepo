package com.shepherdjerred.mcbridge.adapter.paper;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.adapter.http.Json;
import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.Box;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import com.shepherdjerred.mcbridge.domain.Limits;
import com.shepherdjerred.mcbridge.domain.PaletteGrid;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.bukkit.ChunkSnapshot;
import org.bukkit.World;
import org.bukkit.block.BlockState;

/**
 * Exact block states of a box. Chunk snapshots are taken on the main thread (loading chunks
 * asynchronously); the palette grid is built on the calling HTTP thread from the snapshots.
 */
public final class RegionReader {
  private static final Duration TIMEOUT = Duration.ofMinutes(2);

  private final ServerService server;
  private final MainThread mainThread;

  /** One chunk column's snapshot plus the block entities inside the box. */
  private record ChunkData(int chunkX, int chunkZ, ChunkSnapshot snapshot, List<Entity> entities) {}

  /** A block entity position and its holder block id. */
  private record Entity(BlockPos pos, String id) {}

  public RegionReader(ServerService server, MainThread mainThread) {
    this.server = server;
    this.mainThread = mainThread;
  }

  /** {@code /v1/regions/read}. */
  public JsonObject read(Box box) {
    box.requireVolumeAtMost(Limits.MAX_READ_VOLUME);
    if (box.chunkColumns() > Limits.MAX_CHUNK_COLUMNS) {
      throw new BridgeException(
          ErrorCode.TOO_LARGE,
          "box touches "
              + box.chunkColumns()
              + " chunk columns; limit "
              + Limits.MAX_CHUNK_COLUMNS);
    }
    List<ChunkData> chunks = mainThread.callAsync(() -> snapshot(box), TIMEOUT);
    PaletteGrid grid = new PaletteGrid(box);
    JsonArray blockEntities = new JsonArray();
    for (ChunkData chunk : chunks) {
      fill(grid, chunk);
      for (Entity entity : chunk.entities()) {
        JsonObject entry = new JsonObject();
        entry.add("pos", Json.pos(entity.pos()));
        entry.addProperty("id", entity.id());
        blockEntities.add(entry);
      }
    }
    JsonArray palette = new JsonArray();
    grid.palette().forEach(palette::add);
    JsonObject response = new JsonObject();
    response.addProperty("world", box.world());
    response.add("min", Json.pos(box.min()));
    response.add("max", Json.pos(box.max()));
    response.add("size", Json.pos(box.size()));
    response.add("palette", palette);
    response.addProperty("blocks", grid.encodedIndices());
    response.add("blockEntities", blockEntities);
    return response;
  }

  private CompletableFuture<List<ChunkData>> snapshot(Box box) {
    World world = server.world(box.world());
    box.requireWithinHeight(world.getMinHeight(), world.getMaxHeight() - 1);
    List<CompletableFuture<ChunkData>> futures = new ArrayList<>();
    for (int chunkX = box.min().x() >> 4; chunkX <= box.max().x() >> 4; chunkX++) {
      for (int chunkZ = box.min().z() >> 4; chunkZ <= box.max().z() >> 4; chunkZ++) {
        int cx = chunkX;
        int cz = chunkZ;
        futures.add(
            world
                .getChunkAtAsync(cx, cz)
                .thenApply(
                    chunk ->
                        new ChunkData(
                            cx,
                            cz,
                            chunk.getChunkSnapshot(false, false, false),
                            entitiesIn(chunk.getTileEntities(false), box))));
      }
    }
    return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
        .thenApply(done -> futures.stream().map(CompletableFuture::join).toList());
  }

  private static List<Entity> entitiesIn(BlockState[] states, Box box) {
    List<Entity> entities = new ArrayList<>();
    for (BlockState state : states) {
      BlockPos pos = new BlockPos(state.getX(), state.getY(), state.getZ());
      if (contains(box, pos)) {
        String data = state.getBlockData().getAsString();
        int bracket = data.indexOf('[');
        entities.add(new Entity(pos, bracket < 0 ? data : data.substring(0, bracket)));
      }
    }
    return entities;
  }

  private static boolean contains(Box box, BlockPos pos) {
    return pos.x() >= box.min().x()
        && pos.x() <= box.max().x()
        && pos.y() >= box.min().y()
        && pos.y() <= box.max().y()
        && pos.z() >= box.min().z()
        && pos.z() <= box.max().z();
  }

  private static void fill(PaletteGrid grid, ChunkData chunk) {
    Box box = grid.box();
    int baseX = chunk.chunkX() << 4;
    int baseZ = chunk.chunkZ() << 4;
    int fromX = Math.max(box.min().x(), baseX);
    int toX = Math.min(box.max().x(), baseX + 15);
    int fromZ = Math.max(box.min().z(), baseZ);
    int toZ = Math.min(box.max().z(), baseZ + 15);
    for (int y = box.min().y(); y <= box.max().y(); y++) {
      for (int z = fromZ; z <= toZ; z++) {
        for (int x = fromX; x <= toX; x++) {
          String state = chunk.snapshot().getBlockData(x - baseX, y, z - baseZ).getAsString();
          grid.set(x, y, z, state);
        }
      }
    }
  }
}
