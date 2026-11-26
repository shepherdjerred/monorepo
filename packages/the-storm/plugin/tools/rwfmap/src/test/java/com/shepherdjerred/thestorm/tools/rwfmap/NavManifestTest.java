package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class NavManifestTest {

  private static final String BASE = "https://assets.example/the-storm/nav/sha256";

  /** The published SHA-256 test vector for the three bytes {@code abc}. */
  private static final String ABC_SHA =
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  @TempDir Path rwf;

  private static String sha(char digit) {
    return String.valueOf(digit).repeat(64);
  }

  private Path nav(String folder, String content) throws IOException {
    var file = rwf.resolve(folder).resolve(MapFolder.NAV_FILE);
    Files.createDirectories(file.getParent());
    Files.writeString(file, content, UTF_8);
    return file;
  }

  @Test
  void writesAndReadsBackTheSameManifest() {
    var manifest =
        new NavManifest(
            BASE,
            List.of(
                new NavManifest.Entry("lobby/nav.rwfnav", sha('a'), 3),
                new NavManifest.Entry("maps/training-yard/nav.rwfnav", sha('b'), 4)));

    manifest.write(rwf);

    assertThat(NavManifest.load(rwf)).isEqualTo(manifest);
    assertThat(manifest.url(manifest.objects().get(1)))
        .hasToString(BASE + "/" + sha('b') + ".rwfnav");
    assertThat(new NavManifest(BASE, List.of()).json())
        .isEqualTo("{\n  \"baseUrl\": \"" + BASE + "\",\n  \"objects\": []\n}\n");
  }

  @Test
  void rejectsEntriesThatCouldEscapeOrMisnameAnArtifact() {
    assertThatThrownBy(() -> new NavManifest.Entry("maps/../../etc/nav.rwfnav", sha('a'), 1))
        .hasMessageContaining("path must be");
    assertThatThrownBy(() -> new NavManifest.Entry("maps/valley/blocks.schem", sha('a'), 1))
        .hasMessageContaining("path must be");
    assertThatThrownBy(() -> new NavManifest.Entry("lobby/nav.rwfnav", "ABC", 1))
        .hasMessageContaining("sha256");
    assertThatThrownBy(() -> new NavManifest.Entry("lobby/nav.rwfnav", sha('a'), 0))
        .hasMessageContaining("bytes");
    var lobby = new NavManifest.Entry("lobby/nav.rwfnav", sha('a'), 1);
    var valley = new NavManifest.Entry("maps/valley/nav.rwfnav", sha('b'), 1);
    assertThatThrownBy(() -> new NavManifest(BASE + "/", List.of()))
        .hasMessageContaining("baseUrl");
    assertThatThrownBy(() -> new NavManifest(BASE, List.of(lobby, lobby)))
        .hasMessageContaining("more than once");
    assertThatThrownBy(() -> new NavManifest(BASE, List.of(valley, lobby)))
        .hasMessageContaining("ordered by path");
  }

  @Test
  void anUnknownFieldOrAMissingManifestFailsTheLoad() throws IOException {
    assertThatThrownBy(() -> NavManifest.load(rwf)).hasMessageContaining("could not be read");

    Files.writeString(
        NavManifest.file(rwf), "{\"baseUrl\": \"" + BASE + "\", \"objects\": [], \"extra\": 1}");

    assertThatThrownBy(() -> NavManifest.load(rwf)).hasMessageContaining("Invalid");
  }

  @Test
  void refreshingDescribesBakedFilesAndKeepsEntriesOfArtifactsNotFetched() throws IOException {
    nav("lobby", "abc");
    nav("maps/baked", "rebaked");
    Files.createDirectories(rwf.resolve("maps/unfetched"));
    new NavManifest(
            BASE,
            List.of(
                new NavManifest.Entry("maps/baked/nav.rwfnav", sha('1'), 99),
                new NavManifest.Entry("maps/removed/nav.rwfnav", sha('2'), 7),
                new NavManifest.Entry("maps/unfetched/nav.rwfnav", sha('3'), 8)))
        .write(rwf);

    var refreshed = NavManifest.refreshed(rwf);

    assertThat(refreshed.baseUrl()).isEqualTo(BASE);
    assertThat(refreshed.objects())
        .containsExactly(
            new NavManifest.Entry("lobby/nav.rwfnav", ABC_SHA, 3),
            new NavManifest.Entry(
                "maps/baked/nav.rwfnav",
                NavManifest.sha256(rwf.resolve("maps/baked/nav.rwfnav")),
                7),
            new NavManifest.Entry("maps/unfetched/nav.rwfnav", sha('3'), 8));
  }

  @Test
  void refreshingFailsForAFolderWithNeitherAnArtifactNorAnEntry() throws IOException {
    Files.createDirectories(rwf.resolve("maps/never-baked"));
    new NavManifest(BASE, List.of()).write(rwf);

    assertThatThrownBy(() -> NavManifest.refreshed(rwf))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("never-baked")
        .hasMessageContaining("bake it first");
  }
}
