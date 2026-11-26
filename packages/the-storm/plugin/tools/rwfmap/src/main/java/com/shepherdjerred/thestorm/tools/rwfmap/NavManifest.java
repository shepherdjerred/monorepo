package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * {@code rwf/nav-manifest.json}: the tracked description of every baked {@code nav.rwfnav}. The
 * artifacts themselves are not in Git. Each one is stored once under its own SHA-256 at {@code
 * <baseUrl>/<sha256>.rwfnav} and materialised into the checkout by {@link NavFetch}, so the
 * manifest is what review, caches and the image build see when a bake changes.
 *
 * @param baseUrl where the objects are served, without a trailing slash
 * @param objects one entry per artifact, ordered by path
 */
public record NavManifest(String baseUrl, List<Entry> objects) {

  public static final String FILE_NAME = "nav-manifest.json";

  /** The suffix of every stored object's name. */
  public static final String OBJECT_EXTENSION = ".rwfnav";

  private static final Pattern BASE_URL = Pattern.compile("https?://[A-Za-z0-9.:-]+(/[\\w.-]+)*");
  private static final Pattern PATH =
      Pattern.compile("(?:lobby|maps/[a-z0-9]+(?:-[a-z0-9]+)*)/nav\\.rwfnav");
  private static final Pattern SHA256 = Pattern.compile("[a-f0-9]{64}");
  private static final int BUFFER_BYTES = 1 << 16;

  /**
   * One artifact.
   *
   * @param path the file below {@code rwf/}, with forward slashes
   * @param sha256 the lowercase hex SHA-256 of its bytes, which is also its object name
   * @param bytes its exact size
   */
  public record Entry(String path, String sha256, long bytes) {

    public Entry {
      if (!PATH.matcher(path).matches()) {
        throw new IllegalArgumentException(
            "path must be lobby/nav.rwfnav or maps/<id>/nav.rwfnav, not " + path);
      }
      if (!SHA256.matcher(sha256).matches()) {
        throw new IllegalArgumentException("sha256 must be 64 lowercase hex digits");
      }
      if (bytes <= 0) {
        throw new IllegalArgumentException("bytes must be positive");
      }
    }
  }

  public NavManifest {
    if (!BASE_URL.matcher(baseUrl).matches()) {
      throw new IllegalArgumentException(
          "baseUrl must be an http(s) URL without a trailing slash, query or fragment");
    }
    objects = List.copyOf(objects);
    var paths = new HashSet<String>();
    for (var entry : objects) {
      if (!paths.add(entry.path())) {
        throw new IllegalArgumentException("objects lists " + entry.path() + " more than once");
      }
    }
    if (!objects.equals(objects.stream().sorted(Comparator.comparing(Entry::path)).toList())) {
      throw new IllegalArgumentException("objects must be ordered by path");
    }
  }

  /** The manifest inside {@code rwfRoot}. */
  public static Path file(Path rwfRoot) {
    return rwfRoot.resolve(FILE_NAME);
  }

  /** Reads and strictly parses the manifest of {@code rwfRoot}, or throws naming every problem. */
  public static NavManifest load(Path rwfRoot) {
    return ConfigFiles.load(file(rwfRoot), NavManifest.class);
  }

  /**
   * Where {@code entry}'s bytes are served. The object keeps the artifact's extension: the public
   * site treats a path without one as a directory and never serves it.
   */
  public URI url(Entry entry) {
    return URI.create(baseUrl + "/" + entry.sha256() + OBJECT_EXTENSION);
  }

  /**
   * The manifest of {@code rwfRoot} after a bake: every artifact present on disk is described by
   * its current bytes, and one that has not been fetched into this checkout keeps the entry it
   * already has. A lobby or map folder with neither fails; an entry whose folder is gone is
   * dropped.
   */
  public static NavManifest refreshed(Path rwfRoot) {
    var current = load(rwfRoot);
    var known =
        current.objects().stream()
            .collect(Collectors.toUnmodifiableMap(Entry::path, Function.identity()));
    var entries = new ArrayList<Entry>();
    for (var path : artifactPaths(rwfRoot)) {
      var file = rwfRoot.resolve(path);
      if (Files.isRegularFile(file)) {
        entries.add(describe(path, file));
        continue;
      }
      var kept = known.get(path);
      if (kept == null) {
        throw new IllegalStateException(
            file + " is missing and " + FILE_NAME + " has no entry for it; bake it first");
      }
      entries.add(kept);
    }
    return new NavManifest(current.baseUrl(), entries);
  }

  /** Writes this manifest into {@code rwfRoot} in the repository's JSON formatting. */
  public void write(Path rwfRoot) {
    try {
      Files.writeString(file(rwfRoot), json(), UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("could not write " + file(rwfRoot), e);
    }
  }

  /** The deterministic JSON text, one field per line so a rebake diffs as one changed hash. */
  public String json() {
    var json = new StringBuilder("{\n  \"baseUrl\": \"").append(baseUrl).append("\",\n");
    if (objects.isEmpty()) {
      return json.append("  \"objects\": []\n}\n").toString();
    }
    json.append("  \"objects\": [\n");
    for (var index = 0; index < objects.size(); index++) {
      var entry = objects.get(index);
      json.append("    {\n      \"path\": \"")
          .append(entry.path())
          .append("\",\n      \"sha256\": \"")
          .append(entry.sha256())
          .append("\",\n      \"bytes\": ")
          .append(entry.bytes())
          .append("\n    }")
          .append(index + 1 < objects.size() ? ",\n" : "\n");
    }
    return json.append("  ]\n}\n").toString();
  }

  /** The lowercase hex SHA-256 of {@code file}, streamed so a large artifact never fills memory. */
  public static String sha256(Path file) {
    MessageDigest digest;
    try {
      digest = MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("this JVM has no SHA-256", e);
    }
    try (var in = Files.newInputStream(file)) {
      var buffer = new byte[BUFFER_BYTES];
      for (var read = in.read(buffer); read >= 0; read = in.read(buffer)) {
        digest.update(buffer, 0, read);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("could not read " + file, e);
    }
    return HexFormat.of().formatHex(digest.digest());
  }

  private static Entry describe(String path, Path file) {
    try {
      return new Entry(path, sha256(file), Files.size(file));
    } catch (IOException e) {
      throw new UncheckedIOException("could not read " + file, e);
    }
  }

  /** The artifact every lobby and map folder under {@code rwfRoot} owns, ordered by path. */
  private static List<String> artifactPaths(Path rwfRoot) {
    var paths = new ArrayList<String>();
    if (Files.isDirectory(rwfRoot.resolve("lobby"))) {
      paths.add("lobby/" + MapFolder.NAV_FILE);
    }
    var maps = rwfRoot.resolve("maps");
    try (var listing = Files.list(maps)) {
      listing
          .filter(Files::isDirectory)
          .map(folder -> "maps/" + folder.getFileName() + "/" + MapFolder.NAV_FILE)
          .forEach(paths::add);
    } catch (IOException e) {
      throw new UncheckedIOException("Required folder " + maps + " could not be read", e);
    }
    return paths.stream().sorted().toList();
  }
}
