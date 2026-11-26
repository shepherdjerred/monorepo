package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The fetch against a local HTTP store: what it downloads, what it reuses, and that an object the
 * store does not serve, or serves with other bytes, stops it without leaving a file behind.
 */
final class NavFetchTest {

  private static final String LOBBY = "lobby/nav.rwfnav";
  private static final String YARD = "maps/training-yard/nav.rwfnav";

  @TempDir Path temp;

  private final Map<String, byte[]> served = new ConcurrentHashMap<>();
  private final AtomicInteger requests = new AtomicInteger();
  private final AtomicInteger failuresToServe = new AtomicInteger();
  private HttpServer server;
  private Path rwf;
  private Path cache;

  @BeforeEach
  void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/nav/",
        exchange -> {
          requests.incrementAndGet();
          var body = served.get(exchange.getRequestURI().getPath().substring("/nav/".length()));
          try (exchange) {
            if (failuresToServe.getAndUpdate(left -> Math.max(0, left - 1)) > 0) {
              exchange.sendResponseHeaders(503, -1);
            } else if (body == null) {
              exchange.sendResponseHeaders(404, -1);
            } else {
              exchange.sendResponseHeaders(200, body.length);
              exchange.getResponseBody().write(body);
            }
          }
        });
    server.start();
    rwf = temp.resolve("rwf");
    cache = temp.resolve("cache");
    Files.createDirectories(rwf.resolve("lobby"));
    Files.createDirectories(rwf.resolve("maps/training-yard"));
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  private NavFetch fetcher() {
    return new NavFetch(HttpClient.newHttpClient(), cache, Duration.ZERO);
  }

  /** Records {@code content} as the bytes of {@code path} and returns the manifest entry. */
  private NavManifest.Entry entry(String path, String content) throws IOException {
    var bytes = content.getBytes(UTF_8);
    var scratch = Files.write(temp.resolve("scratch"), bytes);
    return new NavManifest.Entry(path, NavManifest.sha256(scratch), bytes.length);
  }

  private void publish(NavManifest.Entry entry, String content) {
    served.put(entry.sha256() + NavManifest.OBJECT_EXTENSION, content.getBytes(UTF_8));
  }

  private void manifest(NavManifest.Entry... entries) {
    var base = "http://127.0.0.1:" + server.getAddress().getPort() + "/nav";
    new NavManifest(base, List.of(entries)).write(rwf);
  }

  @Test
  void downloadsOnceThenReusesTheFileAndTheCache() throws IOException {
    var lobby = entry(LOBBY, "lobby mesh");
    var yard = entry(YARD, "training yard mesh");
    publish(lobby, "lobby mesh");
    publish(yard, "training yard mesh");
    manifest(lobby, yard);

    assertThat(fetcher().fetch(rwf)).isEqualTo(new NavFetch.Report(0, 0, 2));
    assertThat(rwf.resolve(LOBBY)).hasContent("lobby mesh");
    assertThat(rwf.resolve(YARD)).hasContent("training yard mesh");
    assertThat(cache.resolve(yard.sha256())).hasContent("training yard mesh");

    assertThat(fetcher().fetch(rwf)).isEqualTo(new NavFetch.Report(2, 0, 0));

    Files.delete(rwf.resolve(YARD));
    Files.writeString(rwf.resolve(LOBBY), "a mesh left by another branch");
    assertThat(fetcher().fetch(rwf)).isEqualTo(new NavFetch.Report(0, 2, 0));
    assertThat(rwf.resolve(LOBBY)).hasContent("lobby mesh");
    assertThat(rwf.resolve(YARD)).hasContent("training yard mesh");
    assertThat(requests).hasValue(2);
    assertThat(leftovers()).isEmpty();
  }

  @Test
  void anObjectTheStoreDoesNotServeStopsTheFetch() throws IOException {
    var lobby = entry(LOBBY, "never published");
    manifest(lobby);

    assertThatThrownBy(() -> fetcher().fetch(rwf))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("%s.rwfnav returned HTTP 404", lobby.sha256())
        .hasMessageContaining("maps:publish-nav");
    assertThat(rwf.resolve(LOBBY)).doesNotExist();
    assertThat(requests).hasValue(1);
    assertThat(leftovers()).isEmpty();
  }

  @Test
  void bytesThatDoNotMatchTheManifestAreNeverUsed() throws IOException {
    var lobby = entry(LOBBY, "the baked mesh");
    publish(lobby, "something else entirely");
    manifest(lobby);

    assertThatThrownBy(() -> fetcher().fetch(rwf))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("served 23 bytes")
        .hasMessageContaining("expects 14 bytes hashing to %s", lobby.sha256())
        .hasMessageContaining(LOBBY);
    assertThat(rwf.resolve(LOBBY)).doesNotExist();
    assertThat(cache.resolve(lobby.sha256())).doesNotExist();
    assertThat(leftovers()).isEmpty();
  }

  @Test
  void aFalteringStoreIsRetriedButAPersistentFailureStopsTheFetch() throws IOException {
    var lobby = entry(LOBBY, "lobby mesh");
    publish(lobby, "lobby mesh");
    manifest(lobby);

    failuresToServe.set(2);
    assertThat(fetcher().fetch(rwf)).isEqualTo(new NavFetch.Report(0, 0, 1));
    assertThat(requests).hasValue(3);

    Files.delete(rwf.resolve(LOBBY));
    Files.delete(cache.resolve(lobby.sha256()));
    failuresToServe.set(3);
    assertThatThrownBy(() -> fetcher().fetch(rwf))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("could not be downloaded in 3 attempts")
        .hasRootCauseMessage(
            "http://127.0.0.1:%s/nav/%s.rwfnav returned HTTP 503",
            server.getAddress().getPort(), lobby.sha256());
    assertThat(rwf.resolve(LOBBY)).doesNotExist();
  }

  @Test
  void aCacheEntryHoldingOtherBytesIsNotTrusted() throws IOException {
    var lobby = entry(LOBBY, "lobby mesh");
    publish(lobby, "lobby mesh");
    manifest(lobby);
    Files.createDirectories(cache);
    Files.writeString(cache.resolve(lobby.sha256()), "truncated");

    assertThatThrownBy(() -> fetcher().fetch(rwf))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("does not hold its own name's bytes");
    assertThat(rwf.resolve(LOBBY)).doesNotExist();
    assertThat(requests).hasValue(0);
  }

  @Test
  void anEntryForAFolderThatDoesNotExistFails() throws IOException {
    var gone = entry("maps/removed-map/nav.rwfnav", "mesh");
    publish(gone, "mesh");
    manifest(gone);

    assertThatThrownBy(() -> fetcher().fetch(rwf))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("maps/removed-map/nav.rwfnav")
        .hasMessageContaining("is not a folder");
    assertThat(rwf.resolve("maps/removed-map")).doesNotExist();
  }

  @Test
  void clonesThroughTheSystemCopyWhereOneExists() {
    assertThat(NavFetch.cloneCommand("Mac OS X")).containsExactly("cp", "-c");
    assertThat(NavFetch.cloneCommand("Linux")).containsExactly("cp", "--reflink=auto");
    assertThat(NavFetch.cloneCommand("Windows 11")).isEmpty();
  }

  @Test
  void cachesUnderTheUsersCacheRootUnlessADirectoryIsNamed() {
    var home = System.getProperty("user.home");

    assertThat(NavFetch.cacheDirectory(Optional.empty(), Optional.empty()))
        .isEqualTo(Path.of(home, ".cache", "the-storm", "nav", "sha256"));
    assertThat(NavFetch.cacheDirectory(Optional.empty(), Optional.of("/ci/xdg")))
        .isEqualTo(Path.of("/ci/xdg/the-storm/nav/sha256"));
    assertThat(NavFetch.cacheDirectory(Optional.of("/named"), Optional.of("/ci/xdg")))
        .isEqualTo(Path.of("/named"));
  }

  /** Partial downloads and copies the fetch should never leave behind. */
  private List<Path> leftovers() throws IOException {
    var found = new ArrayList<Path>();
    for (var folder : List.of(cache, rwf.resolve("lobby"), rwf.resolve("maps/training-yard"))) {
      if (!Files.isDirectory(folder)) {
        continue;
      }
      try (var listing = Files.list(folder)) {
        listing.filter(file -> file.toString().endsWith(".partial")).forEach(found::add);
      }
    }
    return found;
  }
}
