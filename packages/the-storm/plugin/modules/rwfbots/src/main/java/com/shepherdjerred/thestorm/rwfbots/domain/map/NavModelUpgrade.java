package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.core.result.Result;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Explicit offline model-3 migration; ordinary runtime decoding never accepts legacy artifacts. */
public final class NavModelUpgrade {
  private static final int LEGACY_VERSION = 3;
  private static final int TARGET_VERSION = 4;
  private static final int META = 1;
  private static final int GRAPH = 4;
  private static final int SECTIONS = 10;

  private NavModelUpgrade() {}

  /** Immutable original terrain and declared sites, verified by the offline map-folder reader. */
  public record Source(
      String mapId,
      String blocksSha256,
      BlockClassification terrain,
      NavSites sites,
      String classificationSha256) {}

  /** Inflated payload hashes name the exact original sections retained without re-encoding. */
  public record Preservation(
      Map<Integer, String> sections, String graphPrefixSha256, int tailBytes) {
    public Preservation {
      sections = Map.copyOf(sections);
    }
  }

  public static final class Upgraded {
    private final NavArtifact artifact;
    private final byte[] bytes;
    private final Preservation preservation;

    private Upgraded(NavArtifact artifact, byte[] bytes, Preservation preservation) {
      this.artifact = artifact;
      this.bytes = bytes.clone();
      this.preservation = preservation;
    }

    public NavArtifact artifact() {
      return artifact;
    }

    public byte[] bytes() {
      return bytes.clone();
    }

    public Preservation preservation() {
      return preservation;
    }
  }

  /** Adds actual feet-cell climb bits, preserving every prior analysis payload exactly. */
  public static Result<Upgraded, NavCodec.CodecError> model3(byte[] legacy, Source source) {
    try {
      return Result.ok(upgrade(legacy, source));
    } catch (IOException | IllegalArgumentException e) {
      return Result.err(
          new NavCodec.CodecError(
              e.getMessage() == null ? "invalid model-3 upgrade" : e.getMessage()));
    }
  }

  private static Upgraded upgrade(byte[] legacy, Source source) throws IOException {
    if (!MapBaker.sha256(source.terrain()).equals(source.classificationSha256()))
      throw new IllegalArgumentException(
          "actual terrain differs from the legacy classification hash");
    var raw = NavCodec.readFrame(legacy);
    var sections = sections(raw);
    legacyMeta(raw, sections.getFirst());
    var graph = sections.get(GRAPH - 1);
    var tail = tail(climbable(raw, graph, source.terrain()));
    var changed = splice(raw, sections, tail);
    var bytes = NavCodec.writeFrame(changed);
    var artifact =
        switch (NavCodec.decode(bytes)) {
          case Result.Ok<NavArtifact, NavCodec.CodecError>(var decoded) -> decoded;
          case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
              throw new IllegalArgumentException("upgraded artifact: " + error.message());
        };
    validate(artifact, source);
    var retained = new TreeMap<Integer, String>();
    for (var section : sections)
      if (section.id() != META && section.id() != GRAPH)
        retained.put(section.id(), sha256(raw, section.offset(), section.length()));
    return new Upgraded(
        artifact,
        bytes,
        new Preservation(retained, sha256(raw, graph.offset(), graph.length()), tail.length));
  }

  private record Slice(int id, int offset, int length) {}

  private static List<Slice> sections(byte[] raw) throws IOException {
    var in = new DataInputStream(new ByteArrayInputStream(raw));
    var found = new ArrayList<Slice>();
    for (var expected = 1; expected <= SECTIONS; expected++) {
      var id = in.readInt();
      var length = in.readInt();
      if (id != expected || length < 0 || length > in.available())
        throw new IllegalArgumentException("invalid legacy section " + expected);
      found.add(new Slice(id, raw.length - in.available(), length));
      in.skipNBytes(length);
    }
    if (in.available() != 0)
      throw new IllegalArgumentException("legacy artifact has trailing sections");
    return List.copyOf(found);
  }

  private static void legacyMeta(byte[] raw, Slice section) throws IOException {
    var in = view(raw, section);
    var generator = in.readInt();
    var model = in.readInt();
    if (generator != LEGACY_VERSION || model != LEGACY_VERSION)
      throw new IllegalArgumentException("upgrade requires exact generator-3/model-3 input");
    if (!in.readUTF().equals("server-ticks") || !in.readUTF().equals(DistanceLayout.ENCODING))
      throw new IllegalArgumentException("unsupported legacy scoring units or distance encoding");
    in.readUTF();
    in.readUTF();
    if (in.available() != 0) throw new IllegalArgumentException("legacy META has trailing bytes");
  }

  private static BitSet climbable(byte[] raw, Slice graph, BlockClassification terrain)
      throws IOException {
    var in = view(raw, graph);
    var nodes = in.readInt();
    if (nodes < 0 || nodes > in.available() / Integer.BYTES)
      throw new IllegalArgumentException("invalid legacy graph node count");
    var bits = new BitSet(nodes);
    for (var node = 0; node < nodes; node++) {
      var cell = terrain.bounds().cell(in.readInt());
      bits.set(node, terrain.shape(cell.x(), cell.y(), cell.z()).climbable());
    }
    return bits;
  }

  private static byte[] tail(BitSet bits) throws IOException {
    var bytes = new ByteArrayOutputStream();
    NavCodec.writeBits(bits, new DataOutputStream(bytes));
    return bytes.toByteArray();
  }

  private static byte[] splice(byte[] raw, List<Slice> sections, byte[] tail) throws IOException {
    var bytes = new ByteArrayOutputStream(Math.addExact(raw.length, tail.length));
    var out = new DataOutputStream(bytes);
    for (var section : sections) {
      out.writeInt(section.id());
      out.writeInt(Math.addExact(section.length(), section.id() == GRAPH ? tail.length : 0));
      if (section.id() == META) {
        out.writeInt(TARGET_VERSION);
        out.writeInt(TARGET_VERSION);
        out.write(raw, section.offset() + 2 * Integer.BYTES, section.length() - 2 * Integer.BYTES);
      } else {
        out.write(raw, section.offset(), section.length());
      }
      if (section.id() == GRAPH) out.write(tail);
    }
    return bytes.toByteArray();
  }

  private static void validate(NavArtifact artifact, Source source) {
    if (!artifact.mapId().equals(source.mapId())
        || !artifact.blocksSha256().equals(source.blocksSha256())
        || !artifact.sites().equals(source.sites()))
      throw new IllegalArgumentException(
          "legacy artifact differs from original terrain identity/sites");
    if (!artifact.grid().equals(VoxelGrid.from(source.terrain())))
      throw new IllegalArgumentException("legacy voxel grid differs from actual original terrain");
    var problems = artifact.validate();
    if (!problems.isEmpty())
      throw new IllegalArgumentException("legacy artifact is not playable: " + problems);
  }

  private static DataInputStream view(byte[] raw, Slice section) {
    return new DataInputStream(new ByteArrayInputStream(raw, section.offset(), section.length()));
  }

  private static String sha256(byte[] bytes, int offset, int length) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      digest.update(bytes, offset, length);
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is mandatory", e);
    }
  }
}
