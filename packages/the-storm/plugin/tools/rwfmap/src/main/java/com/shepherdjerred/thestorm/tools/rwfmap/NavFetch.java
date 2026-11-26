package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.file.StandardCopyOption.ATOMIC_MOVE;
import static java.nio.file.StandardCopyOption.REPLACE_EXISTING;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Materialises the {@code nav.rwfnav} files {@link NavManifest} names into a checkout's {@code
 * rwf/} folder. A file already holding the manifest's bytes is left alone. Anything else is
 * replaced from the shared content-addressed cache, which is filled from {@code
 * <baseUrl>/<sha256>.rwfnav}.
 *
 * <p>Every byte is checked against the manifest's SHA-256 and size before it is used. An object the
 * store does not serve, or whose bytes differ, stops the fetch naming it: nothing bakes a
 * substitute and no consumer runs without the artifact.
 */
public final class NavFetch {

  /** Names the cache directory outright, for a run that must not share one. */
  public static final String CACHE_VARIABLE = "THE_STORM_NAV_CACHE";

  /** The user's cache root when it is not {@code ~/.cache}; CI points it at a persistent volume. */
  public static final String CACHE_HOME_VARIABLE = "XDG_CACHE_HOME";

  private static final int ATTEMPTS = 3;
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(30);
  private static final Duration REQUEST_TIMEOUT = Duration.ofMinutes(10);
  private static final int OK = 200;
  private static final int SERVER_ERROR = 500;

  private static final Duration RETRY_PAUSE = Duration.ofSeconds(2);

  private final HttpClient client;
  private final Path cache;
  private final Duration retryPause;

  /**
   * What one fetch did.
   *
   * @param present files that already held the manifest's bytes
   * @param cached files copied from a cache entry an earlier fetch downloaded
   * @param downloaded files downloaded now
   */
  public record Report(int present, int cached, int downloaded) {

    Report plus(Source source) {
      return switch (source) {
        case PRESENT -> new Report(present + 1, cached, downloaded);
        case CACHED -> new Report(present, cached + 1, downloaded);
        case DOWNLOADED -> new Report(present, cached, downloaded + 1);
      };
    }
  }

  /** Where one file's bytes came from. */
  enum Source {
    PRESENT,
    CACHED,
    DOWNLOADED
  }

  /** A failure a later attempt may not repeat: the connection broke or the server faltered. */
  private static final class Transient extends Exception {

    private static final long serialVersionUID = 1L;

    Transient(String message) {
      super(message);
    }

    Transient(String message, Throwable cause) {
      super(message, cause);
    }
  }

  /**
   * A fetcher that keeps objects in {@code cache} and waits {@code retryPause} times the attempt
   * number before retrying a transient failure.
   */
  NavFetch(HttpClient client, Path cache, Duration retryPause) {
    this.client = client;
    this.cache = cache;
    this.retryPause = retryPause;
  }

  /** A fetcher over the real store that keeps objects in {@code cache}. */
  public static NavFetch standard(Path cache) {
    var client =
        HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    return new NavFetch(client, cache, RETRY_PAUSE);
  }

  /**
   * Where objects are cached: {@code override} ({@value #CACHE_VARIABLE}) when given, otherwise
   * {@code the-storm/nav/sha256} under the user's cache root, which is {@code cacheHome} ({@value
   * #CACHE_HOME_VARIABLE}) or {@code ~/.cache}. Every checkout of one user shares it.
   */
  static Path cacheDirectory(Optional<String> override, Optional<String> cacheHome) {
    return override
        .map(Path::of)
        .orElseGet(() ->
            cacheHome
                .map(Path::of)
                .orElseGet(() -> Path.of(System.getProperty("user.home"), ".cache"))
                .resolve(Path.of("the-storm", "nav", "sha256")));
  }

  /** Makes every artifact the manifest of {@code rwfRoot} names present and exact. */
  public Report fetch(Path rwfRoot) {
    var manifest = NavManifest.load(rwfRoot);
    var report = new Report(0, 0, 0);
    for (var entry : manifest.objects()) {
      report = report.plus(materialise(rwfRoot, manifest.url(entry), entry));
    }
    return report;
  }

  private Source materialise(Path rwfRoot, URI url, NavManifest.Entry entry) {
    var target = rwfRoot.resolve(entry.path());
    if (holds(target, entry)) {
      return Source.PRESENT;
    }
    var folder = target.getParent();
    if (folder == null || !Files.isDirectory(folder)) {
      throw new IllegalStateException(
          NavManifest.FILE_NAME + " names " + entry.path() + " but " + folder + " is not a folder");
    }
    var object = cache.resolve(entry.sha256());
    var source = Source.CACHED;
    if (Files.exists(object)) {
      if (!holds(object, entry)) {
        throw new IllegalStateException(
            "cached " + object + " does not hold its own name's bytes; delete it and fetch again");
      }
    } else {
      download(url, entry, object);
      source = Source.DOWNLOADED;
    }
    place(object, target);
    return source;
  }

  private static boolean holds(Path file, NavManifest.Entry entry) {
    try {
      return Files.isRegularFile(file)
          && Files.size(file) == entry.bytes()
          && NavManifest.sha256(file).equals(entry.sha256());
    } catch (IOException e) {
      throw new UncheckedIOException("could not read " + file, e);
    }
  }

  /** Downloads {@code entry} into the cache, verified, and visible there only once complete. */
  private void download(URI url, NavManifest.Entry entry, Path object) {
    Path partial;
    try {
      Files.createDirectories(cache);
      partial = Files.createTempFile(cache, entry.sha256() + ".", ".partial");
    } catch (IOException e) {
      throw new UncheckedIOException("could not write to the nav cache " + cache, e);
    }
    try {
      receive(url, partial);
      if (!holds(partial, entry)) {
        throw new IllegalStateException(
            url
                + " served "
                + size(partial)
                + " bytes hashing to "
                + NavManifest.sha256(partial)
                + ", but "
                + NavManifest.FILE_NAME
                + " expects "
                + entry.bytes()
                + " bytes hashing to "
                + entry.sha256()
                + " for "
                + entry.path());
      }
      Files.move(partial, object, ATOMIC_MOVE, REPLACE_EXISTING);
    } catch (IOException e) {
      throw new UncheckedIOException("could not store " + object, e);
    } finally {
      delete(partial);
    }
  }

  private void receive(URI url, Path partial) {
    for (var attempt = 1; ; attempt++) {
      try {
        attempt(url, partial);
        return;
      } catch (Transient failure) {
        if (attempt == ATTEMPTS) {
          throw new IllegalStateException(
              url + " could not be downloaded in " + ATTEMPTS + " attempts", failure);
        }
        pause(url, retryPause.multipliedBy(attempt));
      }
    }
  }

  private static void pause(URI url, Duration time) {
    try {
      Thread.sleep(time);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("interrupted while downloading " + url, e);
    }
  }

  private void attempt(URI url, Path partial) throws Transient {
    var request = HttpRequest.newBuilder(url).timeout(REQUEST_TIMEOUT).GET().build();
    HttpResponse<InputStream> response;
    try {
      response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
    } catch (IOException e) {
      throw new Transient(url + " could not be reached", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("interrupted while downloading " + url, e);
    }
    try (var body = response.body()) {
      if (response.statusCode() >= SERVER_ERROR) {
        throw new Transient(url + " returned HTTP " + response.statusCode());
      }
      if (response.statusCode() != OK) {
        throw new IllegalStateException(
            url
                + " returned HTTP "
                + response.statusCode()
                + "; a baked nav.rwfnav must be published (bun run maps:publish-nav) before "
                + NavManifest.FILE_NAME
                + " that names it is committed");
      }
      Files.copy(body, partial, REPLACE_EXISTING);
    } catch (IOException e) {
      throw new Transient(url + " broke off mid-download", e);
    }
  }

  /**
   * Copies {@code object} to {@code target} through a sibling temporary file, so a reader never
   * sees a partial artifact. The copy shares the cache's blocks where the file system can (APFS,
   * Btrfs, XFS), which the JDK's own copy does not ask for.
   */
  private static void place(Path object, Path target) {
    // Named by this process and absent before the copy: a clone needs a target that does not exist.
    var partial =
        target.resolveSibling(
            target.getFileName() + "." + ProcessHandle.current().pid() + ".partial");
    try {
      Files.deleteIfExists(partial);
      copy(object, partial);
      Files.move(partial, target, ATOMIC_MOVE, REPLACE_EXISTING);
    } catch (IOException e) {
      throw new UncheckedIOException("could not write " + target, e);
    } finally {
      delete(partial);
    }
  }

  private static void copy(Path from, Path to) throws IOException {
    var command = cloneCommand(System.getProperty("os.name"));
    if (command.isEmpty()) {
      Files.copy(from, to, REPLACE_EXISTING);
      return;
    }
    var arguments = new ArrayList<>(command);
    arguments.add(from.toString());
    arguments.add(to.toString());
    var process = new ProcessBuilder(arguments).inheritIO().start();
    try {
      var code = process.waitFor();
      if (code != 0) {
        throw new IOException(String.join(" ", arguments) + " exited with " + code);
      }
    } catch (InterruptedException e) {
      process.destroy();
      Thread.currentThread().interrupt();
      throw new IOException("interrupted while copying " + from, e);
    }
  }

  /**
   * The system copy that clones when it can and copies otherwise, or none where the JDK's plain
   * copy is all there is.
   */
  static List<String> cloneCommand(String osName) {
    var os = osName.toLowerCase(Locale.ROOT);
    if (os.contains("mac")) {
      return List.of("cp", "-c");
    }
    if (os.contains("linux")) {
      return List.of("cp", "--reflink=auto");
    }
    return List.of();
  }

  private static long size(Path file) {
    try {
      return Files.size(file);
    } catch (IOException e) {
      throw new UncheckedIOException("could not read " + file, e);
    }
  }

  private static void delete(Path partial) {
    try {
      Files.deleteIfExists(partial);
    } catch (IOException e) {
      throw new UncheckedIOException("could not remove " + partial, e);
    }
  }
}
