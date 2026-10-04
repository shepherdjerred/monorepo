package com.shepherdjerred.mcbridge.adapter.worldedit;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.adapter.http.Json;
import com.shepherdjerred.mcbridge.adapter.paper.ServerService;
import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import com.shepherdjerred.mcbridge.domain.Rotation;
import com.shepherdjerred.mcbridge.domain.SessionName;
import com.shepherdjerred.mcbridge.domain.WeOp;
import com.sk89q.worldedit.EditSession;
import com.sk89q.worldedit.LocalSession;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.event.platform.CommandEvent;
import com.sk89q.worldedit.extension.platform.Capability;
import com.sk89q.worldedit.extension.platform.permission.ActorSelectorLimits;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardFormat;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardFormats;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardReader;
import com.sk89q.worldedit.function.operation.Operation;
import com.sk89q.worldedit.function.operation.Operations;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.math.Vector3;
import com.sk89q.worldedit.math.transform.AffineTransform;
import com.sk89q.worldedit.regions.RegionSelector;
import com.sk89q.worldedit.registry.state.Property;
import com.sk89q.worldedit.session.ClipboardHolder;
import com.sk89q.worldedit.session.Placement;
import com.sk89q.worldedit.session.PlacementType;
import com.sk89q.worldedit.world.World;
import com.sk89q.worldedit.world.block.BlockType;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** WorldEdit commands, API pastes, undo, and the block registry for the synthetic agent actors. */
public final class WorldEditService {
  /** WorldEdit edits can be large; give them longer than ordinary world work. */
  public static final Duration EDIT_TIMEOUT = Duration.ofMinutes(2);

  private final AgentSessions sessions;
  private final ServerService server;
  private final MainThread mainThread;
  private final EventRing events;

  /** A decoded clipboard plus where it lands. */
  public record PasteResult(int changed, BlockPos min, BlockPos max, int historySize) {}

  public WorldEditService(
      AgentSessions sessions, ServerService server, MainThread mainThread, EventRing events) {
    this.sessions = sessions;
    this.server = server;
    this.mainThread = mainThread;
    this.events = events;
  }

  /** The DataVersion WorldEdit's platform reports. */
  public int dataVersion() {
    return WorldEdit.getInstance()
        .getPlatformManager()
        .queryCapability(Capability.WORLD_EDITING)
        .getDataVersion();
  }

  /** {@code /v1/we/run}. */
  public JsonObject run(SessionName name, String worldName, List<WeOp> ops) {
    AgentActor actor = sessions.actor(name);
    JsonArray results = new JsonArray();
    for (WeOp op : ops) {
      events.add(EventType.COMMAND, actor.getName(), op.command());
      results.add(mainThread.call(() -> runOne(actor, worldName, op), EDIT_TIMEOUT));
    }
    JsonObject response = new JsonObject();
    response.add("results", results);
    response.addProperty("historySize", actor.historySize());
    return response;
  }

  private JsonObject runOne(AgentActor actor, String worldName, WeOp op) {
    World world = BukkitAdapter.adapt(server.world(worldName));
    LocalSession session = sessions.session(actor);
    actor.log().clear();
    actor.resetChanged();
    boolean threw = false;
    try {
      session.setWorldOverride(world);
      select(actor, session, world, op);
      requireKnownCommand(op);
      WorldEdit.getInstance()
          .getPlatformManager()
          .getPlatformCommandManager()
          .handleCommand(new CommandEvent(actor, op.command()));
    } catch (BridgeException e) {
      throw e;
    } catch (RuntimeException e) {
      threw = true;
      actor.log().error(e.getClass().getSimpleName() + ": " + e.getMessage());
    }
    List<String> errors = actor.log().errors();
    JsonObject result = new JsonObject();
    result.addProperty("command", op.command());
    result.addProperty("ok", !threw && errors.isEmpty());
    result.addProperty("changed", actor.changed());
    result.add("messages", Json.strings(actor.log().messages()));
    result.add("errors", Json.strings(errors));
    return result;
  }

  private static void select(AgentActor actor, LocalSession session, World world, WeOp op) {
    RegionSelector selector = session.getRegionSelector(world);
    ActorSelectorLimits limits = ActorSelectorLimits.forActor(actor);
    BlockPos primary = op.pos1() != null ? op.pos1() : op.at();
    if (primary != null) {
      selector.selectPrimary(vector(primary), limits);
    }
    if (op.pos2() != null) {
      selector.selectSecondary(vector(op.pos2()), limits);
    }
    if (op.at() != null) {
      session.setPlacement(new Placement(PlacementType.POS1, BlockVector3.ZERO));
    } else {
      session.setPlacement(new Placement(PlacementType.WORLD, BlockVector3.ZERO));
    }
  }

  private static void requireKnownCommand(WeOp op) {
    boolean known =
        WorldEdit.getInstance()
            .getPlatformManager()
            .getPlatformCommandManager()
            .getCommandManager()
            .containsCommand(op.commandName());
    if (!known) {
      throw BridgeException.badRequest("unknown WorldEdit command: " + op.command());
    }
  }

  /** Decodes a schematic in any format WorldEdit knows. Runs on the calling thread. */
  public static Clipboard decode(byte[] bytes) {
    ClipboardFormat format =
        ClipboardFormats.findByInputStream(() -> new ByteArrayInputStream(bytes));
    if (format == null) {
      throw BridgeException.badRequest("schematic is not in a format WorldEdit recognizes");
    }
    try (ClipboardReader reader = format.getReader(new ByteArrayInputStream(bytes))) {
      return reader.read();
    } catch (IOException e) {
      throw new BridgeException(ErrorCode.BAD_REQUEST, "schematic could not be read", e);
    }
  }

  /** Pastes a clipboard with its origin at {@code at}, recording it in the session's history. */
  public PasteResult paste(
      SessionName name, String worldName, Clipboard clipboard, PastePlacement placement) {
    AgentActor actor = sessions.actor(name);
    return mainThread.call(() -> pasteOnMain(actor, worldName, clipboard, placement), EDIT_TIMEOUT);
  }

  /**
   * Where and how a clipboard is pasted.
   *
   * @param at where the clipboard origin lands
   * @param rotation rotation around Y, as WorldEdit's {@code //rotate}
   * @param ignoreAir whether air in the clipboard leaves the world untouched
   */
  public record PastePlacement(BlockPos at, Rotation rotation, boolean ignoreAir) {}

  private PasteResult pasteOnMain(
      AgentActor actor, String worldName, Clipboard clipboard, PastePlacement placement)
      throws WorldEditException {
    World world = BukkitAdapter.adapt(server.world(worldName));
    LocalSession session = sessions.session(actor);
    AffineTransform transform = new AffineTransform().rotateY(-placement.rotation().degrees());
    BlockVector3 at = vector(placement.at());
    actor.resetChanged();
    EditSession editSession =
        WorldEdit.getInstance().newEditSessionBuilder().world(world).actor(actor).build();
    try (editSession) {
      ClipboardHolder holder = new ClipboardHolder(clipboard);
      holder.setTransform(transform);
      Operation operation =
          holder.createPaste(editSession).to(at).ignoreAirBlocks(placement.ignoreAir()).build();
      Operations.complete(operation);
    } finally {
      session.remember(editSession);
    }
    BlockPos[] bounds = bounds(clipboard, transform, at);
    return new PasteResult(actor.changed(), bounds[0], bounds[1], actor.historySize());
  }

  private static BlockPos[] bounds(
      Clipboard clipboard, AffineTransform transform, BlockVector3 at) {
    BlockVector3 min = clipboard.getRegion().getMinimumPoint().subtract(clipboard.getOrigin());
    BlockVector3 max = clipboard.getRegion().getMaximumPoint().subtract(clipboard.getOrigin());
    Vector3 a = transform.apply(min.toVector3());
    Vector3 b = transform.apply(max.toVector3());
    BlockVector3 first = a.round().toBlockPoint().add(at);
    BlockVector3 second = b.round().toBlockPoint().add(at);
    return new BlockPos[] {
      new BlockPos(
          Math.min(first.x(), second.x()),
          Math.min(first.y(), second.y()),
          Math.min(first.z(), second.z())),
      new BlockPos(
          Math.max(first.x(), second.x()),
          Math.max(first.y(), second.y()),
          Math.max(first.z(), second.z()))
    };
  }

  /** {@code /v1/we/undo}: undoes up to {@code steps} edits, newest first. */
  public JsonObject undo(SessionName name, int steps) {
    AgentActor actor = sessions.actor(name);
    int undone =
        mainThread.call(
            () -> {
              LocalSession session = sessions.session(actor);
              int count = 0;
              actor.beginUndo();
              try {
                while (count < steps && session.undo(null, actor) != null) {
                  count++;
                }
              } finally {
                actor.endUndo(count);
              }
              return count;
            },
            EDIT_TIMEOUT);
    JsonObject response = new JsonObject();
    response.addProperty("undone", undone);
    response.addProperty("historySize", actor.historySize());
    return response;
  }

  /** {@code /v1/registry} block entries, sorted by id. */
  public JsonArray registryBlocks() {
    return mainThread.call(WorldEditService::collectBlocks, MainThread.DEFAULT_TIMEOUT);
  }

  private static JsonArray collectBlocks() {
    List<BlockType> types = new ArrayList<>(BlockType.REGISTRY.values());
    types.sort(Comparator.comparing(BlockType::id));
    JsonArray blocks = new JsonArray();
    for (BlockType type : types) {
      JsonObject properties = new JsonObject();
      for (Map.Entry<String, ? extends Property<?>> entry : type.getPropertyMap().entrySet()) {
        JsonArray values = new JsonArray();
        for (Object value : entry.getValue().values()) {
          values.add(String.valueOf(value).toLowerCase(Locale.ROOT));
        }
        properties.add(entry.getKey(), values);
      }
      JsonObject block = new JsonObject();
      block.addProperty("id", type.id());
      block.addProperty("defaultState", type.getDefaultState().getAsString());
      block.add("properties", properties);
      blocks.add(block);
    }
    return blocks;
  }

  private static BlockVector3 vector(BlockPos pos) {
    return BlockVector3.at(pos.x(), pos.y(), pos.z());
  }
}
