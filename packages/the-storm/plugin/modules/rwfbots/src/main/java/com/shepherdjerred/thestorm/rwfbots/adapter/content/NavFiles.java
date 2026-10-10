package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyNav;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Loads the baked navigation artifact of every rwf map: {@code
 * plugins/TheStorm/rwf/maps/<mapId>/nav.rwfnav}, written by the {@code rwfmap} tool next to the
 * map's {@code map.yml} and {@code blocks.schem}. A map folder without an artifact, or with one
 * that does not decode, fails {@link NavArtifact#validate()} or names another map, is reported by
 * map id so the module can log it and run that map humans-only. Whether the artifact was baked from
 * the terrain the match plays on is checked later, when the match chooses the map and its block
 * hash is known. File I/O: call it at enable.
 */
public final class NavFiles {

  /** The rwf maps folder inside the plugin data folder. */
  public static final String MAPS_DIRECTORY = "rwf/maps";

  /** The artifact's file name inside a map folder. */
  public static final String FILE_NAME = "nav.rwfnav";

  /** The rwf lobby folder inside the plugin data folder. */
  public static final String LOBBY_DIRECTORY = "rwf/lobby";

  private NavFiles() {}

  /**
   * What was found.
   *
   * @param artifacts the usable artifacts by map id
   * @param problems why each other map folder has none
   */
  public record Loaded(Map<String, NavArtifact> artifacts, Map<String, String> problems) {

    public Loaded {
      artifacts = Map.copyOf(artifacts);
      problems = Map.copyOf(problems);
    }
  }

  /**
   * Loads the lobby's artifact from {@code plugins/TheStorm/rwf/lobby/nav.rwfnav}. The lobby ships
   * with rwf and its artifact is verified by the build, so a missing, corrupt or unusable one stops
   * the module, naming why.
   */
  public static NavArtifact loadLobby(Path dataDirectory) {
    var file = dataDirectory.resolve(LOBBY_DIRECTORY).resolve(FILE_NAME);
    if (!Files.isRegularFile(file)) {
      throw new IllegalStateException(file + " is missing; bake it with gradle bakeRwfLobby");
    }
    byte[] bytes;
    try {
      bytes = Files.readAllBytes(file);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + file + " could not be read", e);
    }
    var artifact =
        switch (NavCodec.decode(bytes)) {
          case Result.Ok<NavArtifact, NavCodec.CodecError>(var decoded) -> decoded;
          case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
              throw new IllegalStateException(file + " does not decode: " + error.message());
        };
    var problems = LobbyNav.problems(artifact);
    if (artifact.generatorVersion() != MapBaker.GENERATOR_VERSION)
      throw new IllegalStateException(file + " uses an obsolete generator; rebake the lobby");
    if (!problems.isEmpty()) {
      throw new IllegalStateException(file + " is unusable: " + String.join("; ", problems));
    }
    return artifact;
  }

  /** Loads every map folder under {@code dataDirectory}, which is {@code plugins/TheStorm}. */
  public static Loaded load(Path dataDirectory) {
    return loadMaps(dataDirectory.resolve(MAPS_DIRECTORY));
  }

  /** Loads every map folder directly under {@code mapsDirectory}. */
  public static Loaded loadMaps(Path mapsDirectory) {
    var artifacts = new TreeMap<String, NavArtifact>();
    var problems = new TreeMap<String, String>();
    for (var folder : mapFolders(mapsDirectory)) {
      var mapId = folder.getFileName().toString();
      switch (read(folder.resolve(FILE_NAME), mapId)) {
        case Result.Ok<NavArtifact, String>(var artifact) -> artifacts.put(mapId, artifact);
        case Result.Err<NavArtifact, String>(var problem) -> problems.put(mapId, problem);
      }
    }
    return new Loaded(artifacts, problems);
  }

  private static List<Path> mapFolders(Path mapsDirectory) {
    if (!Files.isDirectory(mapsDirectory)) {
      throw new IllegalStateException(
          mapsDirectory + " is not a folder; rwf maps are required for rwfbots");
    }
    try (var listing = Files.list(mapsDirectory)) {
      return listing.filter(Files::isDirectory).sorted().toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Required folder " + mapsDirectory + " could not be read", e);
    }
  }

  /** One artifact file, or why it is unusable for {@code mapId}. */
  public static Result<NavArtifact, String> read(Path file, String mapId) {
    if (!Files.isRegularFile(file)) {
      return Result.err("no " + FILE_NAME + "; bake one with the rwfmap tool");
    }
    byte[] bytes;
    try {
      bytes = Files.readAllBytes(file);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + file + " could not be read", e);
    }
    return NavCodec.decode(bytes)
        .mapError(error -> FILE_NAME + " does not decode: " + error.message())
        .flatMap(artifact -> check(artifact, mapId));
  }

  private static Result<NavArtifact, String> check(NavArtifact artifact, String mapId) {
    if (!artifact.mapId().equals(mapId)) {
      return Result.err(FILE_NAME + " was baked for map " + artifact.mapId() + ", not " + mapId);
    }
    if (artifact.generatorVersion() != MapBaker.GENERATOR_VERSION)
      return Result.err(FILE_NAME + " uses an obsolete generator; rebake the map");
    var problems = artifact.validate();
    if (!problems.isEmpty()) {
      return Result.err(
          FILE_NAME
              + " is unplayable: "
              + problems.stream().map(Object::toString).collect(Collectors.joining("; ")));
    }
    return Result.ok(artifact);
  }
}
