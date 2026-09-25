package com.shepherdjerred.thestorm.arena.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Broken content stops the module with a message that says what is wrong. */
final class ContentFilesTest {

  @TempDir Path directory;

  /** Copies the shipped files into {@code directory}, editing {@code file} on the way. */
  private void copy(String file, UnaryOperator<String> edit) throws IOException {
    for (var name :
        new String[] {
          ContentFiles.SETTINGS,
          ContentFiles.CLASSES,
          ContentFiles.WAVES,
          "arena/arenas/colosseum.yml"
        }) {
      var text = Files.readString(ShippedContentTest.SHIPPED.resolve(name));
      var target = directory.resolve(name);
      Files.createDirectories(target.getParent());
      Files.writeString(target, name.equals(file) ? edit.apply(text) : text);
    }
  }

  @Test
  void theShippedCopyLoads() throws IOException {
    copy("", text -> text);

    var content = ContentFiles.load(directory);

    assertThat(content.arenas()).hasSize(1);
    assertThat(
            content
                .settings()
                .messages()
                .render(
                    Notice.of(
                        NoticeKind.BOSS_WAVE, Map.of("wave", "50", "boss", "Warlord Gorrak"))))
        .isEqualTo("Wave 50: Warlord Gorrak has come for you!");
  }

  @Test
  void aMessageMayOnlyUseItsOwnPlaceholders() throws IOException {
    copy(
        ContentFiles.SETTINGS,
        text -> text.replace("Wave {wave} cleared.", "Wave {wave} cleared by {player}."));

    assertThatThrownBy(() -> ContentFiles.load(directory))
        .hasMessageContaining("WAVE_CLEARED")
        .hasMessageContaining("{player}");
  }

  @Test
  void unknownKeysAreErrors() throws IOException {
    copy(
        ContentFiles.SETTINGS,
        text -> text.replace("countdown: PT10S", "countdown: PT10S\ncountdwn: PT5S"));

    assertThatThrownBy(() -> ContentFiles.load(directory)).hasMessageContaining("countdwn");
  }

  @Test
  void aGapInTheWaveTableIsNamed() throws IOException {
    copy(
        ContentFiles.WAVES,
        text ->
            text.replace(
                "  - from: 71\n    to: 71\n    kind: UPGRADE\n    spawns: []\n    boss: null\n",
                ""));

    assertThatThrownBy(() -> ContentFiles.load(directory))
        .hasMessageContaining("wave 71 is not covered by any entry");
  }

  @Test
  void anArenaFileMustBeNamedForItsId() throws IOException {
    copy("", text -> text);
    Files.move(
        directory.resolve("arena/arenas/colosseum.yml"),
        directory.resolve("arena/arenas/other.yml"));

    assertThatThrownBy(() -> ContentFiles.load(directory))
        .hasMessageContaining("name it colosseum.yml");
  }

  @Test
  void anArenaWithASignForAMissingClassIsRejected() throws IOException {
    copy(
        "arena/arenas/colosseum.yml",
        text ->
            text.replace(
                "  lancer: { x: 1015, y: 65, z: 1005 }", "  wizard: { x: 1015, y: 65, z: 1005 }"));

    assertThatThrownBy(() -> ContentFiles.load(directory))
        .hasMessageContaining("unknown class wizard");
  }

  @Test
  void thereMustBeAnArena() throws IOException {
    copy("", text -> text);
    Files.delete(directory.resolve("arena/arenas/colosseum.yml"));

    assertThatThrownBy(() -> ContentFiles.load(directory)).hasMessageContaining("has no arenas");
  }

  @Test
  void theArenasFolderMustExist() throws IOException {
    copy("", text -> text);
    Files.delete(directory.resolve("arena/arenas/colosseum.yml"));
    Files.delete(directory.resolve("arena/arenas"));

    assertThatThrownBy(() -> ContentFiles.load(directory)).isInstanceOf(UncheckedIOException.class);
  }

  @Test
  void aVaultPastTheFinalWaveIsRejected() throws IOException {
    copy(ContentFiles.SETTINGS, text -> text.replace("      - wave: 72\n", "      - wave: 73\n"));

    assertThatThrownBy(() -> ContentFiles.load(directory))
        .hasMessageContaining("vault milestone 73 is past the final wave");
  }
}
