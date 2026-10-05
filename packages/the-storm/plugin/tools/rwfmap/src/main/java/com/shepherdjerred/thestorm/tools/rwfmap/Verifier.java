package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyBuild;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyNav;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * Checks a map folder's committed {@code nav.rwfnav} and {@code nav.summary.json} against a fresh
 * bake: both must match byte for byte, the committed artifact must decode, carry the schematic's
 * hash and validate clean. The lobby is checked the same way, and its {@code blocks.schem} and
 * {@code lobby.yml} must also still be what {@link LobbyBuild} generates. Every finding is
 * reported, not just the first.
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
   * Verifies the lobby folder: the schematic and layout are what the generator builds, the declared
   * hash is the schematic's, and the nav files match a fresh bake.
   */
  public static List<String> verify(LobbyFolder lobby) {
    var failures = new ArrayList<String>();
    var generated = LobbyFolder.generated();
    var schematic = committed(lobby.blocksFile());
    if (schematic.isEmpty()
        || !Arrays.equals(schematic.orElseThrow(), LobbyFolder.generatedBytes())) {
      failures.add(lobby.blocksFile() + " is not what LobbyBuild generates; run bakeRwfLobby");
    }
    if (!lobby.file().blocksSha256().equals(generated.sha256())) {
      failures.add(
          "lobby.yml declares blocksSha256 "
              + lobby.file().blocksSha256()
              + " but LobbyBuild generates "
              + generated.sha256());
    }
    if (!lobby.layout().equals(LobbyBuild.layout())) {
      failures.add(
          "lobby.yml describes "
              + lobby.layout()
              + " but LobbyBuild lays the room out as "
              + LobbyBuild.layout());
    }
    var baked = Baker.bake(lobby);
    if (!baked.playable()) {
      failures.add("the lobby bakes with problems: " + baked.problems());
    }
    navFiles(
        new Committed(
            LobbyNav.ID, lobby.navFile(), lobby.summaryFile(), lobby.schematic().sha256()),
        baked,
        failures);
    return List.copyOf(failures);
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
