import com.google.gson.Gson;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLocksStore;
import com.shepherdjerred.thestorm.towns.app.LockBook;
import com.shepherdjerred.thestorm.towns.app.ParcelBook;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageConfig;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageIndex;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelsConfig;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Read-only native container survey and transactional locks in the fresh restoration database. */
public final class NativeHistoricalLocks {
  private static final Set<String> CONTAINERS = Set.of(
      "minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel", "minecraft:furnace",
      "minecraft:blast_furnace", "minecraft:smoker", "minecraft:brewing_stand", "minecraft:hopper",
      "minecraft:dropper", "minecraft:dispenser", "minecraft:crafter", "minecraft:shulker_box");
  private static final Map<UUID, String> CUSTODY = Map.of(Lock.Restoration.CUSTODIAN, "Staff custody");

  private record Holding(String id, Map<UUID, String> owners) {
    Holding { owners = Map.copyOf(owners); }
  }

  private record Container(BlockPos pos, String block, CompoundTag state, String nbtSha256) {}

  private final Path world;
  private final TownsState state;
  private final RegionFileStorage storage;
  private final Map<ChunkPos, CompoundTag> chunks = new LinkedHashMap<>();
  private final Map<UUID, String> names = new HashMap<>();

  private NativeHistoricalLocks(Path world, TownsState state, RegionFileStorage storage) {
    this.world = world;
    this.state = state;
    this.storage = storage;
  }

  public static void main(String[] args) throws Exception {
    var diagnostics = System.err;
    try {
      run(args);
    } catch (Exception failure) {
      failure.printStackTrace(diagnostics);
      diagnostics.flush();
      throw failure;
    }
  }

  private static void run(String[] args) throws Exception {
    if (args.length != 7) {
      throw new IllegalArgumentException("Expected native world, fresh database, heritage, parcels, towns, request UUID, new receipt");
    }
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Historical lock import requires Paper 26.2");
    }
    Bootstrap.bootStrap();
    var world = regularDirectory(Path.of(args[0]));
    var database = regularFile(Path.of(args[1]));
    var heritagePath = regularFile(Path.of(args[2]));
    var parcelsPath = regularFile(Path.of(args[3]));
    var townsPath = regularFile(Path.of(args[4]));
    var request = UUID.fromString(args[5]);
    if (request.equals(new UUID(0, 0))) throw new IllegalArgumentException("Historical import needs a restoration request");
    var output = Path.of(args[6]).toAbsolutePath().normalize();
    if (Files.exists(output) || output.startsWith(world) || database.startsWith(world)) {
      throw new IllegalArgumentException("Import requires independent database and new receipt");
    }
    var heritage = parse(heritagePath, HeritageConfig.class);
    var parcels = parse(parcelsPath, ParcelsConfig.class);
    var towns = parse(townsPath, TownsConfig.class);
    var state = new TownsState(new RegionIndex(towns.regions()));
    state.attachHeritage(new HeritageIndex(heritage.sites()));
    state.attachParcels(new ParcelBook(parcels, InstantSource.fixed(Instant.EPOCH)));
    var footprint = new HashSet<com.shepherdjerred.thestorm.towns.domain.land.ChunkPos>();
    heritage.sites().stream().filter(site -> site.world().equals("world"))
        .forEach(site -> footprint.addAll(site.footprint()));
    parcels.parcels().stream().filter(parcel -> parcel.area().world().equals("world"))
        .forEach(parcel -> footprint.addAll(parcel.area().footprint()));
    towns.regions().forEach(region -> region.areas().all().stream()
        .filter(area -> area.world().equals("world")).forEach(area -> footprint.addAll(area.footprint())));
    var positions = footprint.stream().sorted(Comparator.comparingInt(
        com.shepherdjerred.thestorm.towns.domain.land.ChunkPos::x)
        .thenComparingInt(com.shepherdjerred.thestorm.towns.domain.land.ChunkPos::z)).toList();
    var planned = new ArrayList<Lock>();
    var inventory = new ArrayList<Map<String, Object>>();
    var surveyed = new ArrayList<Container>();
    var seen = new HashSet<BlockPos>();
    var conflicts = new ArrayList<Map<String, Object>>();
    long ignoredArenaContainers = 0;
    long legacyDoubleChests = 0;
    var regions = world.resolve("dimensions/minecraft/overworld/region");
    var info = new RegionStorageInfo("storm-historical-locks", Level.OVERWORLD, "chunk");
    try (var storage = new RegionFileStorage(info, regularDirectory(regions), true)) {
      var survey = new NativeHistoricalLocks(world, state, storage);
      for (var position : positions) {
        var chunk = survey.chunk(position.x(), position.z());
        for (var pos : survey.containerPositions(chunk, position.x(), position.z())) {
          if ((pos.x() >> 4) != position.x() || (pos.z() >> 4) != position.z()) {
            throw new IllegalStateException("Native container is outside its chunk");
          }
          if (seen.contains(pos)) continue;
          var holding = survey.holding(pos);
          if (holding.isEmpty()) {
            if (survey.arena(pos)) ignoredArenaContainers++;
            continue;
          }
          var container = survey.container(pos);
          var parts = new ArrayList<Container>();
          parts.add(container);
          var partner = survey.partner(container);
          if (partner.isPresent()) {
            var other = survey.container(partner.get());
            if (!other.block().equals(container.block()) || !survey.partner(other).equals(Optional.of(pos))) {
              throw new IllegalStateException("Historical double chest halves disagree");
            }
            parts.add(other);
            if (container.state().getCompound("Properties").orElseThrow().getString("type").orElseThrow().equals("single")) {
              legacyDoubleChests++;
            }
            var otherHolding = survey.holding(other.pos());
            if (!otherHolding.equals(holding)) {
              conflicts.add(Map.of("blocks", parts.stream().map(Container::pos).toList(),
                  "firstHolding", holding.get().id(), "otherHolding", otherHolding.map(Holding::id).orElse("outside-protection")));
              holding = Optional.of(new Holding("boundary-custody", CUSTODY));
            }
          }
          var ordered = parts.stream().map(Container::pos).sorted(Comparator.comparingInt(BlockPos::x)
              .thenComparingInt(BlockPos::y).thenComparingInt(BlockPos::z)).toList();
          if (ordered.stream().anyMatch(seen::contains)) throw new IllegalStateException("Container belongs to multiple locks");
          seen.addAll(ordered);
          var restored = new Lock.Restoration(request, holding.get().id(), holding.get().owners());
          var owner = restored.owners().keySet().stream().min(Comparator.comparing(UUID::toString)).orElseThrow();
          var lock = new Lock(stableId(request, ordered), owner, Set.copyOf(ordered), Map.of(), Lock.Options.NONE, restored);
          planned.add(lock);
          surveyed.addAll(parts);
          inventory.add(Map.of("lockId", lock.id().toString(), "holdingId", restored.holdingId(),
              "owners", restored.owners(), "containers", parts.stream().map(part -> Map.of(
                  "position", part.pos(), "block", part.block(), "blockEntityPresent", !part.nbtSha256().equals("ABSENT"),
                  "blockEntitySha256", part.nbtSha256())).toList()));
        }
      }
      // Every inventoried block entity is read again before a database write; no world bytes are written.
      for (var part : surveyed) {
        if (!survey.container(part.pos()).nbtSha256().equals(part.nbtSha256())) {
          throw new IllegalStateException("Historical container changed during its read-only survey");
        }
      }
    }
    var book = new LockBook();
    book.reload(planned);
    if (book.all().size() != planned.size()) throw new IllegalStateException("Historical locks have duplicate identities");
    importLocks(database, planned);
    try (var db = StormDatabase.open(database)) {
      var actual = new JooqLocksStore(db).loadAll().get(60, TimeUnit.SECONDS);
      if (!new HashSet<>(actual).equals(new HashSet<>(planned))) {
        throw new IllegalStateException("Persisted historical locks differ from their inventory");
      }
    }
    var counts = new TreeMap<String, Long>();
    planned.forEach(lock -> counts.merge(lock.restoration().holdingId(), 1L, Long::sum));
    var facts = new LinkedHashMap<String, Object>();
    facts.put("schemaVersion", 1);
    facts.put("requestId", request.toString());
    facts.put("heritageSha256", hash(Files.readAllBytes(heritagePath)));
    facts.put("parcelsSha256", hash(Files.readAllBytes(parcelsPath)));
    facts.put("townsSha256", hash(Files.readAllBytes(townsPath)));
    facts.put("scannedChunks", positions.size());
    facts.put("locks", planned.size());
    facts.put("containerBlocks", seen.size());
    facts.put("legacyDoubleChests", legacyDoubleChests);
    facts.put("containersWithoutSavedBlockEntity", surveyed.stream().filter(part -> part.nbtSha256().equals("ABSENT")).count());
    facts.put("jointLocks", planned.stream().filter(lock -> lock.owners().size() > 1).count());
    facts.put("custodyLocks", planned.stream().filter(lock -> lock.owner().equals(Lock.Restoration.CUSTODIAN)).count());
    facts.put("historicalOwners", planned.stream().mapToLong(lock -> lock.owners().size()).sum());
    facts.put("ignoredArenaContainers", ignoredArenaContainers);
    facts.put("byHolding", counts);
    facts.put("boundaryConflicts", conflicts);
    facts.put("inventory", inventory);
    facts.put("worldTicks", 0);
    facts.put("terrainChanged", false);
    facts.put("containerContentsChanged", false);
    facts.put("databaseReadback", "VERIFIED");
    Files.writeString(output, new Gson().toJson(facts) + "\n", StandardOpenOption.CREATE_NEW);
  }

  private Optional<Holding> holding(BlockPos pos) throws Exception {
    var land = state.landAt(pos.world(), pos.x(), pos.y(), pos.z());
    if (arena(pos)) return Optional.empty();
    if (land.underlyingLand() instanceof Land.ParcelLand parcel) {
      var owners = new HashMap<UUID, String>();
      for (var owner : parcel.parcel().owners()) owners.put(owner, name(owner));
      return Optional.of(new Holding("parcel:" + parcel.parcel().definition().id(), owners.isEmpty() ? CUSTODY : owners));
    }
    if (land instanceof Land.HeritageLand heritage) {
      var owners = new HashMap<UUID, String>();
      for (var owner : heritage.editors()) owners.put(owner, name(owner));
      return Optional.of(new Holding("heritage:" + heritage.site().id(), owners.isEmpty() ? CUSTODY : owners));
    }
    if (land instanceof Land.RegionLand region) {
      return Optional.of(new Holding("region:" + region.region().id(), CUSTODY));
    }
    return Optional.empty();
  }

  private boolean arena(BlockPos pos) {
    var land = state.landAt(pos.world(), pos.x(), pos.y(), pos.z());
    return (land instanceof Land.HeritageLand heritage && heritage.site().profile() == RegionProfile.ARENA)
        || (land.underlyingLand() instanceof Land.RegionLand region && region.region().profile() == RegionProfile.ARENA);
  }

  private String name(UUID owner) throws Exception {
    if (!names.containsKey(owner)) {
      var path = regularFile(world.resolve("players/data/" + owner + ".dat"));
      var player = NbtIo.readCompressed(path, NbtAccounter.create(64 * 1024 * 1024));
      var name = player.getCompound("bukkit").orElseThrow().getString("lastKnownName").orElseThrow();
      if (name.isBlank()) throw new IllegalStateException("Historical owner has no archived name");
      names.put(owner, name);
    }
    return names.get(owner);
  }

  private CompoundTag chunk(int x, int z) throws Exception {
    var pos = new ChunkPos(x, z);
    if (!chunks.containsKey(pos)) {
      regularFile(world.resolve("dimensions/minecraft/overworld/region/r." + (x >> 5) + "." + (z >> 5) + ".mca"));
      var chunk = storage.read(pos);
      if (chunk == null || NbtUtils.getDataVersion(chunk, -1) != 4903
          || chunk.getInt("xPos").orElseThrow() != x || chunk.getInt("zPos").orElseThrow() != z) {
        throw new IllegalStateException("Historical lock input is outside the verified native archive");
      }
      chunks.put(pos, chunk);
      if (chunks.size() > 128) chunks.remove(chunks.keySet().iterator().next());
    }
    return chunks.get(pos);
  }

  private Container container(BlockPos pos) throws Exception {
    var chunk = chunk(pos.x() >> 4, pos.z() >> 4);
    var tile = blockEntities(chunk).stream().filter(tag ->
        tag.getInt("x").orElseThrow() == pos.x() && tag.getInt("y").orElseThrow() == pos.y()
            && tag.getInt("z").orElseThrow() == pos.z()).findFirst();
    if (tile.isPresent() && !CONTAINERS.contains(tile.get().getString("id").orElseThrow())) {
      throw new IllegalStateException("Historical lock target is not a supported container");
    }
    var state = blockState(pos).orElseThrow();
    var block = state.getString("Name").orElseThrow();
    if (!CONTAINERS.contains(block) && !block.endsWith("_shulker_box")) throw new IllegalStateException("Historical target is not a container block");
    if (tile.isEmpty()) return new Container(pos, block, state, "ABSENT");
    if (!block.equals(tile.get().getString("id").orElseThrow()) && !block.endsWith("_shulker_box")) {
      throw new IllegalStateException("Native container block and entity disagree at " + pos
          + ": " + block + " versus " + tile.get().getString("id").orElseThrow());
    }
    var bytes = new ByteArrayOutputStream();
    NbtIo.write(tile.get(), new DataOutputStream(bytes));
    return new Container(pos, block, state, hash(bytes.toByteArray()));
  }

  private List<BlockPos> containerPositions(CompoundTag chunk, int chunkX, int chunkZ) throws Exception {
    var tiles = new HashSet<BlockPos>();
    for (var tile : blockEntities(chunk)) {
      if (!CONTAINERS.contains(tile.getString("id").orElseThrow())) continue;
      var pos = new BlockPos("world", tile.getInt("x").orElseThrow(), tile.getInt("y").orElseThrow(), tile.getInt("z").orElseThrow());
      if (!tiles.add(pos)) throw new IllegalStateException("Duplicate historical container block entity at " + pos);
    }
    for (var section : chunk.getList("sections").orElseThrow().compoundStream().toList()) {
      if (!section.contains("block_states")) continue; // Native lighting-only sections have no blocks.
      var blocks = section.getCompound("block_states").orElseThrow();
      if (blocks.getList("palette").orElseThrow().compoundStream().noneMatch(value ->
          CONTAINERS.contains(value.getString("Name").orElseThrow()))) continue;
      for (var index = 0; index < 4096; index++) {
        var name = NativeTerrain.paletteEntry(blocks, index).getString("Name").orElseThrow();
        if (!CONTAINERS.contains(name)) continue;
        var pos = new BlockPos("world", chunkX * 16 + index % 16,
            section.getByte("Y").orElseThrow() * 16 + index / 256, chunkZ * 16 + index / 16 % 16);
        tiles.add(pos);
      }
    }
    return tiles.stream().sorted(Comparator.comparingInt(BlockPos::x).thenComparingInt(BlockPos::y).thenComparingInt(BlockPos::z)).toList();
  }

  private Optional<CompoundTag> blockState(BlockPos pos) throws Exception {
    var section = chunk(pos.x() >> 4, pos.z() >> 4).getList("sections").orElseThrow().compoundStream()
        .filter(tag -> tag.getByte("Y").orElseThrow() == (pos.y() >> 4)).findFirst();
    if (section.isEmpty() || !section.get().contains("block_states")) return Optional.empty();
    return Optional.of(NativeTerrain.paletteEntry(section.get().getCompound("block_states").orElseThrow(),
        (pos.y() & 15) * 256 + (pos.z() & 15) * 16 + (pos.x() & 15)));
  }

  private Optional<BlockPos> partner(Container container) throws Exception {
    if (!Set.of("minecraft:chest", "minecraft:trapped_chest").contains(container.block())) return Optional.empty();
    var properties = container.state().getCompound("Properties").orElseThrow();
    var type = properties.getString("type").orElseThrow();
    if (!Set.of("single", "left", "right").contains(type)) throw new IllegalStateException("Invalid chest type");
    var direction = switch (properties.getString("facing").orElseThrow()) {
      case "north" -> new int[] {1, 0};
      case "east" -> new int[] {0, 1};
      case "south" -> new int[] {-1, 0};
      case "west" -> new int[] {0, -1};
      default -> throw new IllegalStateException("Invalid chest facing");
    };
    if (type.equals("single")) {
      // 1.8 cannot place adjacent separate chests of the same kind. The unticked DFU
      // checkpoint retains their facing but has not run native neighbor shape updates.
      // Preserve that historical pair in one lock without changing either block state.
      var candidates = new ArrayList<BlockPos>();
      for (var sign : List.of(-1, 1)) {
        var pos = container.pos();
        var adjacent = new BlockPos(pos.world(), pos.x() + sign * direction[0], pos.y(), pos.z() + sign * direction[1]);
        var hasChest = blockState(adjacent).filter(value -> value.getString("Name").orElseThrow().equals(container.block())).isPresent();
        if (!hasChest) continue;
        var other = container(adjacent);
        var otherProperties = other.state().getCompound("Properties").orElseThrow();
        if (other.block().equals(container.block()) && otherProperties.getString("type").orElseThrow().equals("single")
            && otherProperties.getString("facing").equals(properties.getString("facing"))) candidates.add(adjacent);
      }
      if (candidates.size() > 1) throw new IllegalStateException("Ambiguous historical chest adjacency at " + container.pos());
      return candidates.stream().findFirst();
    }
    var sign = type.equals("left") ? 1 : -1;
    var pos = container.pos();
    return Optional.of(new BlockPos(pos.world(), pos.x() + sign * direction[0], pos.y(), pos.z() + sign * direction[1]));
  }

  private static List<CompoundTag> blockEntities(CompoundTag chunk) {
    // Native saves may omit this optional field when a chunk has no block entities.
    if (!chunk.contains("block_entities")) return List.of();
    var values = chunk.getList("block_entities").orElseThrow();
    var compounds = values.compoundStream().toList();
    if (compounds.size() != values.size()) throw new IllegalStateException("Invalid native block entity list");
    return compounds;
  }

  private static UUID stableId(UUID request, List<BlockPos> parts) {
    return UUID.nameUUIDFromBytes(("the-storm:historical-lock:v1:" + request + ":" + parts).getBytes(StandardCharsets.UTF_8));
  }

  private static void importLocks(Path database, List<Lock> locks) throws Exception {
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database)) {
      connection.createStatement().execute("PRAGMA foreign_keys=ON");
      for (var table : List.of("towns_lock", "towns_lock_block", "towns_lock_trust", "towns_lock_restoration", "towns_lock_historical_owner")) {
        try (var rows = connection.createStatement().executeQuery("SELECT COUNT(*) FROM " + table)) {
          if (!rows.next() || rows.getLong(1) != 0) throw new IllegalStateException("Historical import requires empty " + table);
        }
      }
      connection.setAutoCommit(false);
      try (var lock = connection.prepareStatement("INSERT INTO towns_lock(id,owner_id,shared_with_town,redstone) VALUES(?,?,0,0)");
          var source = connection.prepareStatement("INSERT INTO towns_lock_restoration(lock_id,request_id,holding_id) VALUES(?,?,?)");
          var owner = connection.prepareStatement("INSERT INTO towns_lock_historical_owner(lock_id,player_id,player_name) VALUES(?,?,?)");
          var block = connection.prepareStatement("INSERT INTO towns_lock_block(world,x,y,z,lock_id) VALUES(?,?,?,?,?)")) {
        for (var value : locks) {
          lock.setString(1, value.id().toString()); lock.setString(2, value.owner().toString()); lock.executeUpdate();
          source.setString(1, value.id().toString()); source.setString(2, value.restoration().requestId().toString());
          source.setString(3, value.restoration().holdingId()); source.executeUpdate();
          for (var historical : value.restoration().owners().entrySet()) {
            owner.setString(1, value.id().toString()); owner.setString(2, historical.getKey().toString());
            owner.setString(3, historical.getValue()); owner.executeUpdate();
          }
          for (var pos : value.blocks()) {
            block.setString(1, pos.world()); block.setInt(2, pos.x()); block.setInt(3, pos.y());
            block.setInt(4, pos.z()); block.setString(5, value.id().toString()); block.executeUpdate();
          }
        }
        try (var invalid = connection.createStatement().executeQuery("PRAGMA foreign_key_check")) {
          if (invalid.next()) throw new IllegalStateException("Historical locks violate foreign keys");
        }
        connection.commit();
      } catch (Exception failure) {
        connection.rollback();
        throw failure;
      }
      connection.setAutoCommit(true);
      connection.createStatement().execute("PRAGMA wal_checkpoint(TRUNCATE)");
    }
  }

  private static String hash(byte[] data) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
  }

  private static Path regularDirectory(Path path) throws Exception {
    if (Files.isSymbolicLink(path) || !Files.isDirectory(path)) throw new IllegalArgumentException("Expected a regular native directory");
    return path.toRealPath();
  }

  private static Path regularFile(Path path) throws Exception {
    if (Files.isSymbolicLink(path) || !Files.isRegularFile(path)) throw new IllegalArgumentException("Expected a regular restoration input");
    return path.toRealPath();
  }

  private static <T> T parse(Path path, Class<T> type) throws Exception {
    return StrictYaml.parse(path.toString(), Files.readString(path), type).fold(value -> value,
        errors -> { throw new IllegalArgumentException("Invalid historical lock configuration: " + errors); });
  }
}
