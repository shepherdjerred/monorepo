package com.shepherdjerred.mcbridge.adapter.worldedit;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.shepherdjerred.mcbridge.adapter.http.Fields;
import com.shepherdjerred.mcbridge.adapter.http.Json;
import com.shepherdjerred.mcbridge.adapter.paper.ServerService;
import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.Box;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import com.shepherdjerred.mcbridge.domain.Limits;
import com.shepherdjerred.mcbridge.domain.Rotation;
import com.shepherdjerred.mcbridge.domain.SessionName;
import com.shepherdjerred.mcbridge.domain.SnapshotId;
import com.sk89q.worldedit.EditSession;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardWriter;
import com.sk89q.worldedit.function.operation.ForwardExtentCopy;
import com.sk89q.worldedit.function.operation.Operations;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.CuboidRegion;
import com.sk89q.worldedit.world.World;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;
import java.util.stream.Stream;

/**
 * Server-side region snapshots as Sponge v3 schematics under {@code plugins/MCBridge/snapshots},
 * each with a JSON sidecar. World reads and pastes run on the main thread; encoding and file I/O
 * run on the calling HTTP thread.
 */
public final class SnapshotStore {
  private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
  private static final SessionName RESTORE_SESSION = new SessionName("snapshots");
  private static final Set<String> META_KEYS =
      Set.of("id", "box", "label", "createdAt", "bytes", "sha256");

  private final Path directory;
  private final ServerService server;
  private final WorldEditService worldEdit;
  private final MainThread mainThread;
  private final InstantSource time;
  private final RandomGenerator random;

  /** Collaborators and sources of time and randomness. */
  public record Dependencies(
      ServerService server,
      WorldEditService worldEdit,
      MainThread mainThread,
      InstantSource time,
      RandomGenerator random) {}

  public SnapshotStore(Path directory, Dependencies dependencies) {
    this.directory = directory;
    this.server = dependencies.server();
    this.worldEdit = dependencies.worldEdit();
    this.mainThread = dependencies.mainThread();
    this.time = dependencies.time();
    this.random = dependencies.random();
  }

  /** {@code POST /v1/snapshots}. */
  public JsonObject create(Box box, Optional<String> label) {
    box.requireVolumeAtMost(Limits.MAX_SNAPSHOT_VOLUME);
    Clipboard clipboard = mainThread.call(() -> copy(box), WorldEditService.EDIT_TIMEOUT);
    byte[] bytes = encode(clipboard);
    SnapshotId id = SnapshotId.next(time.instant(), random);
    JsonObject meta = new JsonObject();
    meta.addProperty("id", id.value());
    meta.add("box", Json.box(box));
    label.ifPresent(value -> meta.addProperty("label", value));
    meta.addProperty("createdAt", time.instant().toString());
    meta.addProperty("bytes", bytes.length);
    meta.addProperty("sha256", sha256(bytes));
    try {
      Files.createDirectories(directory);
      Files.write(schematicPath(id), bytes);
      Files.writeString(metaPath(id), GSON.toJson(meta), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("could not write snapshot " + id.value(), e);
    }
    return meta;
  }

  /** {@code GET /v1/snapshots}, oldest first. */
  public JsonObject list() {
    List<JsonObject> metas = new ArrayList<>();
    if (Files.isDirectory(directory)) {
      try (Stream<Path> files = Files.list(directory)) {
        for (Path file : files.filter(path -> path.toString().endsWith(".json")).toList()) {
          metas.add(readMeta(file));
        }
      } catch (IOException e) {
        throw new UncheckedIOException("could not list snapshots", e);
      }
    }
    metas.sort(Comparator.comparing(meta -> meta.get("createdAt").getAsString()));
    JsonArray snapshots = new JsonArray();
    metas.forEach(snapshots::add);
    JsonObject response = new JsonObject();
    response.add("snapshots", snapshots);
    return response;
  }

  /** {@code GET /v1/snapshots/:id}: the raw schematic. */
  public byte[] bytes(SnapshotId id) {
    Path path = schematicPath(id);
    if (!Files.isRegularFile(path)) {
      throw new BridgeException(ErrorCode.NOT_FOUND, "no snapshot " + id.value());
    }
    try {
      return Files.readAllBytes(path);
    } catch (IOException e) {
      throw new UncheckedIOException("could not read snapshot " + id.value(), e);
    }
  }

  /**
   * {@code POST /v1/snapshots/:id/restore}: pastes the snapshot over its original box, air
   * included.
   */
  public JsonObject restore(SnapshotId id) {
    Box box = Fields.of(readMeta(metaPath(id)).get("box"), "snapshot.box", Fields.BOX_KEYS).asBox();
    Clipboard clipboard = WorldEditService.decode(bytes(id));
    WorldEditService.PasteResult result =
        worldEdit.paste(
            RESTORE_SESSION,
            box.world(),
            clipboard,
            new WorldEditService.PastePlacement(box.min(), new Rotation(0), false));
    JsonObject response = new JsonObject();
    response.addProperty("changed", result.changed());
    return response;
  }

  private Clipboard copy(Box box) throws WorldEditException {
    World world = BukkitAdapter.adapt(server.world(box.world()));
    org.bukkit.World bukkitWorld = BukkitAdapter.adapt(world);
    box.requireWithinHeight(bukkitWorld.getMinHeight(), bukkitWorld.getMaxHeight() - 1);
    BlockVector3 min = BlockVector3.at(box.min().x(), box.min().y(), box.min().z());
    BlockVector3 max = BlockVector3.at(box.max().x(), box.max().y(), box.max().z());
    CuboidRegion region = new CuboidRegion(world, min, max);
    BlockArrayClipboard clipboard = new BlockArrayClipboard(region);
    clipboard.setOrigin(min);
    try (EditSession source = WorldEdit.getInstance().newEditSession(world)) {
      ForwardExtentCopy copy = new ForwardExtentCopy(source, region, clipboard, min);
      copy.setCopyingEntities(false);
      copy.setCopyingBiomes(false);
      Operations.complete(copy);
    }
    return clipboard;
  }

  private static byte[] encode(Clipboard clipboard) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (ClipboardWriter writer = BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getWriter(out)) {
      writer.write(clipboard);
    } catch (IOException e) {
      throw new UncheckedIOException("could not encode snapshot", e);
    }
    return out.toByteArray();
  }

  private static JsonObject readMeta(Path path) {
    if (!Files.isRegularFile(path)) {
      throw new BridgeException(ErrorCode.NOT_FOUND, "no snapshot metadata " + path.getFileName());
    }
    try {
      JsonObject meta = JsonParser.parseString(Files.readString(path)).getAsJsonObject();
      Fields.of(meta, "snapshot", META_KEYS);
      return meta;
    } catch (IOException e) {
      throw new UncheckedIOException("could not read " + path, e);
    }
  }

  private Path schematicPath(SnapshotId id) {
    return directory.resolve(id.value() + ".schem");
  }

  private Path metaPath(SnapshotId id) {
    return directory.resolve(id.value() + ".json");
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("the JDK always provides SHA-256", e);
    }
  }
}
