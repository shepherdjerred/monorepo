package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyNav;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Checks a map folder's committed {@code nav.rwfnav} and {@code nav.summary.json} against a fresh
 * bake: both must match byte for byte, the committed artifact must decode, carry the schematic's
 * hash and validate clean. The lobby is checked the same way, and its places must be standable.
 * Every finding is reported, not just the first.
 */
public final class Verifier {

  /**
   * What a fresh bake is compared with.
   *
   * @param id the map id the artifact must name
   * @param navFile the committed artifact
   * @param summaryFile the committed summary
   * @param blocksSha256 the hash of the committed schematic
   */
  private record Committed(String id, Path navFile, Path summaryFile, String blocksSha256) {}

  private Verifier() {}

  /** Verifies {@code map}; an empty list means the committed files are current and correct. */
  public static List<String> verify(MapFolder map) {
    var failures = new ArrayList<String>();
    var baked = Baker.bake(map);
    if (!baked.playable()) {
      failures.add("the map bakes with problems: " + baked.problems());
    }
    navFiles(
        new Committed(map.id(), map.navFile(), map.summaryFile(), map.schematic().sha256()),
        baked,
        failures);
    return List.copyOf(failures);
  }

  /**
   * Verifies the lobby folder: the declared hash is the schematic's, every place a player stands is
   * standable (something solid underfoot, room for feet and head), each shipped kit has exactly one
   * alcove, each team has a side, and the nav files match a fresh bake.
   */
  public static List<String> verify(LobbyFolder lobby) {
    return verify(lobby, SHIPPED_KITS);
  }

  /**
   * The kits the lobby's alcoves must show: the ones the server ships. The full kit book takes its
   * place once every kit ships, and the check takes any list of kits.
   */
  public static final List<KitSpec> SHIPPED_KITS = KitBook.MILESTONE_ONE;

  /** {@link #verify(LobbyFolder)} against {@code kits}, one alcove each. */
  public static List<String> verify(LobbyFolder lobby, List<KitSpec> kits) {
    var failures = new ArrayList<String>();
    var sha = lobby.schematic().sha256();
    if (!lobby.file().blocksSha256().equals(sha)) {
      failures.add(
          "lobby.yml declares blocksSha256 "
              + lobby.file().blocksSha256()
              + " but blocks.schem hashes to "
              + sha
              + "; set it and run bakeRwfLobby");
    }
    var layout = lobby.layout();
    var classified = lobby.classify();
    for (var stand : layout.stands()) {
      standable(classified, stand.position()).ifPresent(failures::add);
    }
    var wanted = kits.stream().map(KitSpec::id).collect(Collectors.toUnmodifiableSet());
    if (!new HashSet<>(layout.kits()).equals(wanted)) {
      failures.add("the alcoves show " + layout.kits() + " but the shipped kits are " + wanted);
    }
    for (var team : TeamColor.values()) {
      if (layout.side(team).isEmpty()) {
        failures.add("the lobby has no side for " + team);
      }
    }
    var baked = Baker.bake(lobby);
    if (!baked.playable()) {
      failures.add("the lobby bakes with problems: " + baked.problems());
    }
    navFiles(
        new Committed(LobbyNav.ID, lobby.navFile(), lobby.summaryFile(), sha), baked, failures);
    return List.copyOf(failures);
  }

  /** Why nobody can stand at {@code at}, if they cannot. */
  static Optional<String> standable(SchematicClassification blocks, Vec3 at) {
    var x = (int) Math.floor(at.x());
    var y = (int) Math.floor(at.y());
    var z = (int) Math.floor(at.z());
    if (!blocks.shape(x, y - 1, z).standable()) {
      return Optional.of("nothing to stand on below " + at);
    }
    if (blocks.shape(x, y, z).blocksMovement() || blocks.shape(x, y + 1, z).blocksMovement()) {
      return Optional.of("no room to stand at " + at);
    }
    return Optional.empty();
  }

  private static void navFiles(Committed target, Baker.Baked baked, List<String> failures) {
    committed(target.navFile())
        .ifPresentOrElse(
            bytes -> navFile(target, baked, bytes, failures),
            () -> failures.add(target.navFile() + " is missing; run bakeRwfMaps"));
    committed(target.summaryFile())
        .ifPresentOrElse(
            bytes -> {
              if (!new String(bytes, UTF_8).equals(baked.summary())) {
                failures.add(target.summaryFile() + " differs from a fresh bake; run bakeRwfMaps");
              }
            },
            () -> failures.add(target.summaryFile() + " is missing; run bakeRwfMaps"));
  }

  private static void navFile(
      Committed target, Baker.Baked baked, byte[] committed, List<String> failures) {
    if (!Arrays.equals(committed, baked.bytes())) {
      failures.add(target.navFile() + " differs from a fresh bake; run bakeRwfMaps");
    }
    switch (NavCodec.decode(committed)) {
      case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
          failures.add(target.navFile() + " does not decode: " + error.message());
      case Result.Ok<NavArtifact, NavCodec.CodecError>(var artifact) -> {
        if (!artifact.blocksSha256().equals(target.blocksSha256())) {
          failures.add(
              target.navFile()
                  + " was baked from blocks hashing to "
                  + artifact.blocksSha256()
                  + " but blocks.schem hashes to "
                  + target.blocksSha256());
        }
        if (!artifact.mapId().equals(target.id())) {
          failures.add(
              target.navFile() + " names map " + artifact.mapId() + ", not " + target.id());
        }
      }
    }
  }

  private static Optional<byte[]> committed(Path file) {
    if (!Files.isRegularFile(file)) {
      return Optional.empty();
    }
    try {
      return Optional.of(Files.readAllBytes(file));
    } catch (IOException e) {
      throw new UncheckedIOException("could not read " + file, e);
    }
  }
}
