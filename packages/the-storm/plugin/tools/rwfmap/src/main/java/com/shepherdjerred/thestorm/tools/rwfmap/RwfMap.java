package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.io.IOException;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * The command line: {@code rwfmap bake <mapDir> [--out <file>]} writes {@code nav.rwfnav} and
 * {@code nav.summary.json} next to the map (or the artifact to {@code --out} and the summary beside
 * it); {@code rwfmap verify <mapDir>} re-bakes in memory and fails when the committed files differ.
 * {@code rwfmap bake-lobby <lobbyDir>} writes the generated lobby's {@code blocks.schem}, then its
 * nav files once {@code lobby.yml} declares the schematic's hash; {@code rwfmap verify-lobby
 * <lobbyDir>} fails when any of the four lobby files is not what the generator and a fresh bake
 * produce. Exit codes: 0 success, 1 usage, 2 the map or its artifacts are wrong.
 */
public final class RwfMap {

  static final int OK = 0;
  static final int USAGE = 1;
  static final int FAILED = 2;

  private static final String USAGE_TEXT =
      """
      usage:
        rwfmap bake <mapDir> [--out <file>]   bake nav.rwfnav and nav.summary.json
        rwfmap verify <mapDir>                 fail if the committed nav files are stale
        rwfmap verify-details <mapDir>         validate allowed payloads against terrain
        rwfmap bake-lobby <lobbyDir>           write the generated lobby and bake its nav files
        rwfmap verify-lobby <lobbyDir>         fail if the committed lobby files are stale
      """;

  private RwfMap() {}

  public static void main(String[] args) {
    System.exit(run(args, System.out, System.err));
  }

  /** Runs the command and returns its exit code; nothing is written to {@code System}. */
  static int run(String[] args, PrintStream out, PrintStream err) {
    if (args.length < 2) {
      err.print(USAGE_TEXT);
      return USAGE;
    }
    var rest = Arrays.asList(args).subList(2, args.length);
    try {
      return switch (args[0]) {
        case "bake" -> bake(Path.of(args[1]), rest, out, err);
        case "verify" -> rest.isEmpty() ? verify(Path.of(args[1]), out, err) : usage(err);
        case "verify-details" -> rest.isEmpty() ? verifyDetails(Path.of(args[1]), out) : usage(err);
        case "bake-lobby" -> rest.isEmpty() ? bakeLobby(Path.of(args[1]), out, err) : usage(err);
        case "verify-lobby" ->
            rest.isEmpty() ? verifyLobby(Path.of(args[1]), out, err) : usage(err);
        default -> usage(err);
      };
    } catch (IllegalArgumentException | IllegalStateException | UncheckedIOException e) {
      err.println("rwfmap: " + e.getMessage());
      return FAILED;
    }
  }

  private static int usage(PrintStream err) {
    err.print(USAGE_TEXT);
    return USAGE;
  }

  private static int verifyDetails(Path folder, PrintStream out) {
    var map = MapFolder.load(folder);
    var details =
        com.shepherdjerred.thestorm.core.config.ConfigFiles.load(
            folder.resolve("details.json"),
            com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails.class);
    details.validate(map.schematic());
    out.println(
        "verified allowed payloads for "
            + map.id()
            + ": "
            + details.containers().size()
            + " inventories, "
            + details.signs().size()
            + " signs");
    return OK;
  }

  private static int bake(Path folder, List<String> options, PrintStream out, PrintStream err) {
    var outFile = outOption(options);
    if (outFile.isEmpty() && !options.isEmpty()) {
      return usage(err);
    }
    var map = MapFolder.load(folder);
    var baked = Baker.bake(map);
    var navFile = outFile.orElseGet(map::navFile);
    var summaryFile =
        outFile.isPresent()
            ? navFile.resolveSibling(navFile.getFileName() + ".summary.json")
            : map.summaryFile();
    write(navFile, baked.bytes());
    write(summaryFile, baked.summary().getBytes(UTF_8));
    out.println(
        "baked "
            + map.id()
            + ": "
            + baked.artifact().graph().nodeCount()
            + " walkable cells, "
            + baked.bytes().length
            + " bytes -> "
            + navFile);
    if (!baked.playable()) {
      err.println("rwfmap: " + map.id() + " is not playable:");
      baked.problems().forEach(problem -> err.println("  " + problem));
      return FAILED;
    }
    return OK;
  }

  private static int verify(Path folder, PrintStream out, PrintStream err) {
    var map = MapFolder.load(folder);
    var failures = Verifier.verify(map);
    if (failures.isEmpty()) {
      out.println("verified " + map.id() + ": nav files match a fresh bake");
      return OK;
    }
    err.println("rwfmap: " + map.id() + " failed verification:");
    failures.forEach(failure -> err.println("  " + failure));
    return FAILED;
  }

  private static int bakeLobby(Path folder, PrintStream out, PrintStream err) {
    var generated = LobbyFolder.generated();
    write(folder.resolve(MapFolder.BLOCKS_FILE), LobbyFolder.generatedBytes());
    out.println("wrote the generated lobby: blocksSha256 " + generated.sha256());
    var lobby = LobbyFolder.load(folder);
    if (!lobby.file().blocksSha256().equals(generated.sha256())) {
      err.println(
          "rwfmap: set blocksSha256 in "
              + folder.resolve(LobbyFolder.LOBBY_FILE)
              + " to "
              + generated.sha256()
              + " and bake again");
      return FAILED;
    }
    var baked = Baker.bake(lobby);
    write(lobby.navFile(), baked.bytes());
    write(lobby.summaryFile(), baked.summary().getBytes(UTF_8));
    out.println(
        "baked the lobby: "
            + baked.artifact().graph().nodeCount()
            + " walkable cells, "
            + baked.bytes().length
            + " bytes -> "
            + lobby.navFile());
    if (!baked.playable()) {
      err.println("rwfmap: the lobby is not usable:");
      baked.problems().forEach(problem -> err.println("  " + problem));
      return FAILED;
    }
    return OK;
  }

  private static int verifyLobby(Path folder, PrintStream out, PrintStream err) {
    var failures = Verifier.verify(LobbyFolder.load(folder));
    if (failures.isEmpty()) {
      out.println("verified the lobby: its files match the generator and a fresh bake");
      return OK;
    }
    err.println("rwfmap: the lobby failed verification:");
    failures.forEach(failure -> err.println("  " + failure));
    return FAILED;
  }

  /** The {@code --out <file>} option, when it is the only option. */
  private static Optional<Path> outOption(List<String> options) {
    if (options.size() == 2 && options.get(0).equals("--out")) {
      return Optional.of(Path.of(options.get(1)));
    }
    return Optional.empty();
  }

  private static void write(Path file, byte[] bytes) {
    try {
      var parent = file.toAbsolutePath().getParent();
      if (parent != null) {
        Files.createDirectories(parent);
      }
      Files.write(file, bytes);
    } catch (IOException e) {
      throw new UncheckedIOException("could not write " + file, e);
    }
  }
}
