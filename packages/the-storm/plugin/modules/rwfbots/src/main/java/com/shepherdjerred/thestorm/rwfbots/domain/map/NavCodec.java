package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.BombScreens;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInput;
import java.io.DataInputStream;
import java.io.DataOutput;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.zip.DataFormatException;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/**
 * The on-disk form of a {@link NavArtifact}: a magic number, the format version, then a deflated
 * body of length-prefixed sections in a fixed order. Anything unexpected, from a wrong magic to a
 * trailing byte, is a decode error rather than a guess.
 */
public final class NavCodec {

  /** "RWFB" as a big-endian int. */
  public static final int MAGIC = 0x52574642;

  public static final int FORMAT_VERSION = 2;

  /** Why a byte array is not an artifact. */
  public record CodecError(String message) {}

  private enum Section {
    META(1),
    SITES(2),
    GRID(3),
    GRAPH(4),
    REGIONS(5),
    COVER(6),
    CHOKEPOINTS(7),
    ROUTES(8),
    DISTANCE(9),
    BOMB_SCREENS(10);

    private final int id;

    Section(int id) {
      this.id = id;
    }
  }

  /** Thrown inside decoding and turned into a {@link CodecError}. */
  private static final class Corrupt extends IOException {
    private static final long serialVersionUID = 1L;

    Corrupt(String message) {
      super(message);
    }
  }

  private NavCodec() {}

  /** Serializes {@code artifact}. */
  public static byte[] encode(NavArtifact artifact) {
    try {
      var body = new ByteArrayOutputStream();
      var out = new DataOutputStream(body);
      for (var section : Section.values()) {
        var buffer = new ByteArrayOutputStream();
        writeSection(section, artifact, new DataOutputStream(buffer));
        out.writeInt(section.id);
        out.writeInt(buffer.size());
        buffer.writeTo(out);
      }
      out.flush();
      var raw = body.toByteArray();
      var compressed = deflate(raw);
      var file = new ByteArrayOutputStream();
      var header = new DataOutputStream(file);
      header.writeInt(MAGIC);
      header.writeInt(FORMAT_VERSION);
      header.writeInt(raw.length);
      header.writeInt(compressed.length);
      header.write(compressed);
      header.flush();
      return file.toByteArray();
    } catch (IOException e) {
      throw new UncheckedIOException("in-memory streams do not fail", e);
    }
  }

  /** Parses {@code bytes}, or says what is wrong with them. */
  public static Result<NavArtifact, CodecError> decode(byte[] bytes) {
    try {
      return Result.ok(read(bytes));
    } catch (IOException | IllegalArgumentException e) {
      return Result.err(new CodecError(e.getMessage() == null ? "corrupt" : e.getMessage()));
    }
  }

  private static NavArtifact read(byte[] bytes) throws IOException {
    var in = new DataInputStream(new ByteArrayInputStream(bytes));
    if (in.readInt() != MAGIC) {
      throw new Corrupt("not a nav artifact: bad magic");
    }
    var formatVersion = in.readInt();
    if (formatVersion != FORMAT_VERSION) {
      throw new Corrupt("unsupported format version " + formatVersion);
    }
    var rawLength = in.readInt();
    var compressedLength = in.readInt();
    if (rawLength < 0 || compressedLength < 0 || compressedLength != in.available()) {
      throw new Corrupt("length prefix does not match the data");
    }
    var raw = inflate(bytes, bytes.length - compressedLength, rawLength);
    var reader = new Reader(raw, formatVersion);
    return reader.artifact();
  }

  private static byte[] deflate(byte[] raw) {
    var deflater = new Deflater(Deflater.BEST_COMPRESSION);
    try {
      deflater.setInput(raw);
      deflater.finish();
      var out = new ByteArrayOutputStream(raw.length / 2 + 64);
      var buffer = new byte[8192];
      while (!deflater.finished()) {
        var count = deflater.deflate(buffer);
        out.write(buffer, 0, count);
      }
      return out.toByteArray();
    } finally {
      deflater.end();
    }
  }

  private static byte[] inflate(byte[] compressed, int offset, int rawLength) throws IOException {
    var inflater = new Inflater();
    try {
      inflater.setInput(compressed, offset, compressed.length - offset);
      var raw = new byte[rawLength];
      var total = 0;
      while (total < rawLength && !inflater.finished()) {
        var count = inflater.inflate(raw, total, rawLength - total);
        if (count == 0 && (inflater.needsInput() || inflater.needsDictionary())) {
          throw new Corrupt("compressed body ended early");
        }
        total += count;
      }
      if (total != rawLength || !inflater.finished()) {
        throw new Corrupt("decompressed length does not match the header");
      }
      return raw;
    } catch (DataFormatException e) {
      throw new Corrupt("compressed body is malformed: " + e.getMessage());
    } finally {
      inflater.end();
    }
  }

  private static void writeSection(Section section, NavArtifact artifact, DataOutput out)
      throws IOException {
    switch (section) {
      case META -> {
        out.writeInt(artifact.generatorVersion());
        out.writeInt(TraversalCosts.MODEL_VERSION);
        out.writeUTF("server-ticks");
        out.writeUTF(DistanceLayout.ENCODING);
        out.writeUTF(artifact.mapId());
        out.writeUTF(artifact.blocksSha256());
      }
      case SITES -> {
        writeSites(artifact.sites().spawns(), out);
        writeSites(artifact.sites().bombs(), out);
      }
      case GRID -> writeGrid(artifact.grid(), out);
      case GRAPH -> writeGraph(artifact.graph(), out);
      case REGIONS -> writeRegions(artifact.regions(), out);
      case COVER -> {
        out.writeInt(artifact.cover().points().size());
        for (var point : artifact.cover().points()) {
          out.writeInt(point.node());
          out.writeShort(point.standingMask());
          out.writeShort(point.crouchedMask());
        }
      }
      case CHOKEPOINTS -> {
        out.writeInt(artifact.chokepoints().points().size());
        for (var point : artifact.chokepoints().points()) {
          out.writeInt(point.node());
          out.writeInt(point.width());
          out.writeDouble(point.routeShare());
          out.writeBoolean(point.alongX());
        }
      }
      case ROUTES -> {
        out.writeInt(artifact.routes().routes().size());
        for (var route : artifact.routes().routes()) {
          out.writeUTF(route.from());
          out.writeUTF(route.to());
          out.writeDouble(route.length());
          writeInts(route.nodes().stream().mapToInt(Integer::intValue).toArray(), out);
        }
      }
      case DISTANCE -> {
        out.writeInt(artifact.distanceFields().size());
        for (var entry : artifact.distanceFields().entrySet()) {
          out.writeUTF(entry.getKey());
          DistanceLayout.write(entry.getValue().values(), out);
        }
      }
      case BOMB_SCREENS -> writeBombScreens(artifact.bombScreens(), out);
    }
  }

  private static void writeSites(List<NavSites.Site> sites, DataOutput out) throws IOException {
    out.writeInt(sites.size());
    for (var site : sites) {
      out.writeUTF(site.name());
      out.writeBoolean(site.team().isPresent());
      if (site.team().isPresent()) {
        out.writeUTF(site.team().get());
      }
      writeCell(site.cell(), out);
    }
  }

  private static void writeGrid(VoxelGrid grid, DataOutput out) throws IOException {
    writeCell(grid.bounds().origin(), out);
    out.writeInt(grid.bounds().sizeX());
    out.writeInt(grid.bounds().sizeY());
    out.writeInt(grid.bounds().sizeZ());
    writeBits(grid.movement(), out);
    writeBits(grid.sight(), out);
    writeBits(grid.projectile(), out);
  }

  private static void writeGraph(NavGraph graph, DataOutput out) throws IOException {
    writeInts(graph.cellOfNodeArray(), out);
    var elevations = graph.halfHeightArray();
    out.writeInt(elevations.length);
    out.write(elevations);
    writeWater(graph.water(), out);
    var topology = graph.topology();
    writeInts(topology.edgeStart(), out);
    writeInts(topology.edgeTo(), out);
    var edges = graph.edgeData();
    out.writeInt(edges.hop().length);
    out.write(edges.hop());
    writeFloats(edges.cost(), out);
    var capabilities = edges.capabilities();
    var damage = capabilities.damage();
    out.writeInt(damage.length);
    out.write(damage);
    writeInts(capabilities.overflow().edges(), out);
    writeInts(capabilities.overflow().values(), out);
    var launch = capabilities.launch();
    writeInts(launch.edges(), out);
    writeFloats(launch.runUp(), out);
    writeFloats(launch.speed(), out);
    writeFloats(launch.offset(), out);
  }

  private static void writeWater(WaterIndex water, DataOutput out) throws IOException {
    writeInts(water.columns(), out);
    writeInts(water.intervals().low(), out);
    writeInts(water.intervals().high(), out);
    writeInts(water.intervals().start(), out);
    writeInts(water.portals().nodes(), out);
    writeInts(water.portals().heights(), out);
  }

  private static void writeBombScreens(BombScreens screens, DataOutput out) throws IOException {
    out.writeInt(screens.sites().size());
    for (var name : screens.sites().keySet().stream().sorted().toList()) {
      var layout = screens.require(name);
      out.writeUTF(name);
      writeInts(layout.workers().stream().mapToInt(Integer::intValue).toArray(), out);
      writeInts(layout.screens().stream().mapToInt(Integer::intValue).toArray(), out);
      out.writeInt(layout.spaciousScreens());
    }
  }

  private static void writeRegions(Regions regions, DataOutput out) throws IOException {
    writeInts(regions.regionOfNodeArray(), out);
    out.writeInt(regions.count());
    for (var centroid : regions.centroids()) {
      out.writeDouble(centroid.x());
      out.writeDouble(centroid.y());
      out.writeDouble(centroid.z());
    }
    writeBits(regions.visibility(), out);
  }

  private static void writeCell(BlockPos cell, DataOutput out) throws IOException {
    out.writeInt(cell.x());
    out.writeInt(cell.y());
    out.writeInt(cell.z());
  }

  private static void writeInts(int[] values, DataOutput out) throws IOException {
    out.writeInt(values.length);
    for (var value : values) {
      out.writeInt(value);
    }
  }

  private static void writeFloats(float[] values, DataOutput out) throws IOException {
    out.writeInt(values.length);
    for (var value : values) {
      out.writeFloat(value);
    }
  }

  private static void writeBits(BitSet bits, DataOutput out) throws IOException {
    var words = bits.toLongArray();
    out.writeInt(words.length);
    for (var word : words) {
      out.writeLong(word);
    }
  }

  /** Reads the sections in order and assembles the artifact. */
  private static final class Reader {

    private static final int MAX_COUNT = 1 << 26;

    private final byte[] raw;
    private final DataInputStream body;
    private final int formatVersion;
    private int generatorVersion;
    private String mapId = "";
    private String sha = "";
    private Optional<NavSites> sites = Optional.empty();
    private Optional<VoxelGrid> grid = Optional.empty();
    private Optional<NavGraph> graph = Optional.empty();
    private Optional<Regions> regions = Optional.empty();
    private Optional<CoverPoints> cover = Optional.empty();
    private Optional<Chokepoints> chokepoints = Optional.empty();
    private Optional<ApproachRoutes> routes = Optional.empty();
    private Optional<BombScreens> bombScreens = Optional.empty();
    private final HashMap<String, DistanceField> fields = new HashMap<>();

    Reader(byte[] raw, int formatVersion) {
      this.raw = raw;
      this.body = new DataInputStream(new ByteArrayInputStream(raw));
      this.formatVersion = formatVersion;
    }

    NavArtifact artifact() throws IOException {
      for (var expected : Section.values()) {
        var id = body.readInt();
        if (id != expected.id) {
          throw new Corrupt("expected section " + expected + " but found id " + id);
        }
        var length = body.readInt();
        if (length < 0 || length > body.available()) {
          throw new Corrupt("section " + expected + " length is wrong");
        }
        var offset = raw.length - body.available();
        var in = new DataInputStream(new ByteArrayInputStream(raw, offset, length));
        body.skipNBytes(length);
        readSection(expected, in);
        if (in.available() != 0) {
          throw new Corrupt("section " + expected + " has trailing bytes");
        }
      }
      if (body.available() != 0) {
        throw new Corrupt("trailing bytes after the last section");
      }
      var artifact =
          new NavArtifact(
              formatVersion,
              generatorVersion,
              mapId,
              sha,
              sites.orElseThrow(),
              grid.orElseThrow(),
              graph.orElseThrow(),
              regions.orElseThrow(),
              cover.orElseThrow(),
              chokepoints.orElseThrow(),
              routes.orElseThrow(),
              fields,
              bombScreens.orElseThrow());
      artifact
          .bombScreens()
          .validateCertification(
              artifact.graph(), artifact.grid(), artifact.sites(), artifact.distanceFields());
      return artifact;
    }

    private void readSection(Section section, DataInput in) throws IOException {
      switch (section) {
        case META -> {
          generatorVersion = in.readInt();
          if (in.readInt() != TraversalCosts.MODEL_VERSION || !in.readUTF().equals("server-ticks"))
            throw new Corrupt("unsupported traversal model or scoring units");
          if (!in.readUTF().equals(DistanceLayout.ENCODING))
            throw new Corrupt("unsupported distance encoding");
          mapId = in.readUTF();
          sha = in.readUTF();
        }
        case SITES -> sites = Optional.of(new NavSites(readSites(in), readSites(in)));
        case GRID -> grid = Optional.of(readGrid(in));
        case GRAPH -> graph = Optional.of(readGraph(in));
        case REGIONS -> regions = Optional.of(readRegions(in));
        case COVER -> cover = Optional.of(readCover(in));
        case CHOKEPOINTS -> chokepoints = Optional.of(readChokepoints(in));
        case ROUTES -> routes = Optional.of(readRoutes(in));
        case DISTANCE -> {
          var count = count(in);
          for (var i = 0; i < count; i++) {
            fields.put(in.readUTF(), new DistanceField(DistanceLayout.read(count(in), in)));
          }
        }
        case BOMB_SCREENS -> bombScreens = Optional.of(readBombScreens(in));
      }
    }

    private static List<NavSites.Site> readSites(DataInput in) throws IOException {
      var count = count(in);
      var sites = new ArrayList<NavSites.Site>(count);
      for (var i = 0; i < count; i++) {
        var name = in.readUTF();
        var team = in.readBoolean() ? Optional.of(in.readUTF()) : Optional.<String>empty();
        sites.add(new NavSites.Site(name, team, readCell(in)));
      }
      return sites;
    }

    private static VoxelGrid readGrid(DataInput in) throws IOException {
      var origin = readCell(in);
      var bounds = new GridBounds(origin, in.readInt(), in.readInt(), in.readInt());
      return new VoxelGrid(bounds, readBits(in), readBits(in), readBits(in));
    }

    private NavGraph readGraph(DataInput in) throws IOException {
      var bounds = grid.orElseThrow().bounds();
      var cellOfNode = readInts(in);
      var elevations = new byte[count(in)];
      in.readFully(elevations);
      var water = readWater(bounds, in);
      var topology = new NavGraph.Topology(readInts(in), readInts(in));
      var hopCount = count(in);
      var hop = new byte[hopCount];
      in.readFully(hop);
      var cost = readFloats(in);
      var damage = new byte[count(in)];
      in.readFully(damage);
      var overflow = new DamageOverflow(readInts(in), readInts(in));
      var launch = new LaunchData(readInts(in), readFloats(in), readFloats(in), readFloats(in));
      return new NavGraph(
          bounds,
          new NavGraph.NodeData(cellOfNode, water, elevations),
          topology,
          new NavGraph.EdgeData(hop, cost, new EdgeCapabilities(damage, overflow, launch)));
    }

    private static WaterIndex readWater(GridBounds bounds, DataInput in) throws IOException {
      return new WaterIndex(
          bounds,
          readInts(in),
          new WaterIndex.Intervals(readInts(in), readInts(in), readInts(in)),
          new WaterIndex.Portals(readInts(in), readInts(in)));
    }

    private static BombScreens readBombScreens(DataInput in) throws IOException {
      var layouts = new java.util.TreeMap<String, BombScreens.Layout>();
      var count = count(in);
      for (var index = 0; index < count; index++) {
        var name = in.readUTF();
        var workers = java.util.Arrays.stream(readInts(in)).boxed().toList();
        var screens = java.util.Arrays.stream(readInts(in)).boxed().toList();
        var layout = new BombScreens.Layout(workers, screens, in.readInt());
        if (layouts.put(name, layout) != null) throw new Corrupt("duplicate bomb screen layout");
      }
      return new BombScreens(layouts);
    }

    private static Regions readRegions(DataInput in) throws IOException {
      var regionOfNode = readInts(in);
      var count = count(in);
      var centroids = new ArrayList<Vec3>(count);
      for (var i = 0; i < count; i++) {
        centroids.add(new Vec3(in.readDouble(), in.readDouble(), in.readDouble()));
      }
      return new Regions(regionOfNode, centroids, readBits(in));
    }

    private static CoverPoints readCover(DataInput in) throws IOException {
      var count = count(in);
      var points = new ArrayList<CoverPoints.CoverPoint>(count);
      for (var i = 0; i < count; i++) {
        points.add(
            new CoverPoints.CoverPoint(
                in.readInt(), in.readUnsignedShort(), in.readUnsignedShort()));
      }
      return new CoverPoints(points);
    }

    private static Chokepoints readChokepoints(DataInput in) throws IOException {
      var count = count(in);
      var points = new ArrayList<Chokepoints.Chokepoint>(count);
      for (var i = 0; i < count; i++) {
        points.add(
            new Chokepoints.Chokepoint(
                in.readInt(), in.readInt(), in.readDouble(), in.readBoolean()));
      }
      return new Chokepoints(points);
    }

    private static ApproachRoutes readRoutes(DataInput in) throws IOException {
      var count = count(in);
      var routes = new ArrayList<ApproachRoutes.Route>(count);
      for (var i = 0; i < count; i++) {
        var from = in.readUTF();
        var to = in.readUTF();
        var length = in.readDouble();
        var nodes = new ArrayList<Integer>();
        for (var node : readInts(in)) {
          nodes.add(node);
        }
        routes.add(new ApproachRoutes.Route(from, to, nodes, length));
      }
      return new ApproachRoutes(routes);
    }

    private static BlockPos readCell(DataInput in) throws IOException {
      return new BlockPos(in.readInt(), in.readInt(), in.readInt());
    }

    private static int count(DataInput in) throws IOException {
      var count = in.readInt();
      if (count < 0 || count > MAX_COUNT) {
        throw new Corrupt("implausible count " + count);
      }
      return count;
    }

    private static int[] readInts(DataInput in) throws IOException {
      var values = new int[count(in)];
      for (var i = 0; i < values.length; i++) {
        values[i] = in.readInt();
      }
      return values;
    }

    private static float[] readFloats(DataInput in) throws IOException {
      var values = new float[count(in)];
      for (var i = 0; i < values.length; i++) {
        values[i] = in.readFloat();
      }
      return values;
    }

    private static BitSet readBits(DataInput in) throws IOException {
      var words = new long[count(in)];
      for (var i = 0; i < words.length; i++) {
        words[i] = in.readLong();
      }
      return BitSet.valueOf(words);
    }
  }
}
