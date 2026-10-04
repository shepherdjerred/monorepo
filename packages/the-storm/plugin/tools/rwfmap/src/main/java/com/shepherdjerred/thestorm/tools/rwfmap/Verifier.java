package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.core.result.Result;
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
 * hash and validate clean. Every finding is reported, not just the first.
 */
public final class Verifier {

  private Verifier() {}

  /** Verifies {@code map}; an empty list means the committed files are current and correct. */
  public static List<String> verify(MapFolder map) {
    var failures = new ArrayList<String>();
    var baked = Baker.bake(map);
    if (!baked.playable()) {
      failures.add("the map bakes with problems: " + baked.problems());
    }
    committed(map.navFile())
        .ifPresentOrElse(
            bytes -> navFile(map, baked, bytes, failures),
            () -> failures.add(map.navFile() + " is missing; run bakeRwfMaps"));
    committed(map.summaryFile())
        .ifPresentOrElse(
            bytes -> {
              if (!new String(bytes, UTF_8).equals(baked.summary())) {
                failures.add(map.summaryFile() + " differs from a fresh bake; run bakeRwfMaps");
              }
            },
            () -> failures.add(map.summaryFile() + " is missing; run bakeRwfMaps"));
    return List.copyOf(failures);
  }

  private static void navFile(
      MapFolder map, Baker.Baked baked, byte[] committed, List<String> failures) {
    if (!Arrays.equals(committed, baked.bytes())) {
      failures.add(map.navFile() + " differs from a fresh bake; run bakeRwfMaps");
    }
    switch (NavCodec.decode(committed)) {
      case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
          failures.add(map.navFile() + " does not decode: " + error.message());
      case Result.Ok<NavArtifact, NavCodec.CodecError>(var artifact) -> {
        if (!artifact.blocksSha256().equals(map.schematic().sha256())) {
          failures.add(
              map.navFile()
                  + " was baked from blocks hashing to "
                  + artifact.blocksSha256()
                  + " but blocks.schem hashes to "
                  + map.schematic().sha256());
        }
        if (!artifact.mapId().equals(map.id())) {
          failures.add(map.navFile() + " names map " + artifact.mapId() + ", not " + map.id());
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
