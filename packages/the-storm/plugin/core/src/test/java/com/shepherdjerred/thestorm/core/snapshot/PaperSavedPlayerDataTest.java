package com.shepherdjerred.thestorm.core.snapshot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.nbt.NbtReader;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.zip.GZIPOutputStream;
import org.bukkit.NamespacedKey;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Reading the restore marker back out of gzipped player-data NBT, and finding the files. */
final class PaperSavedPlayerDataTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final NamespacedKey KEY = new NamespacedKey("thestorm", "rwf_restored_snapshot");

  @TempDir Path level;

  /** A player file shaped like Paper 26.x writes it, with {@code marker} under BukkitValues. */
  private static byte[] playerFile(NbtValue marker) throws IOException {
    var bytes = new ByteArrayOutputStream();
    try (var out = new DataOutputStream(new GZIPOutputStream(bytes))) {
      out.writeByte(NbtReader.COMPOUND);
      out.writeUTF("");
      out.writeByte(NbtReader.INT);
      out.writeUTF("DataVersion");
      out.writeInt(4_325);
      out.writeByte(NbtReader.LIST);
      out.writeUTF("Inventory");
      out.writeByte(NbtReader.COMPOUND);
      out.writeInt(1);
      out.writeByte(NbtReader.STRING);
      out.writeUTF("id");
      out.writeUTF("minecraft:diamond_sword");
      out.writeByte(NbtReader.BYTE);
      out.writeUTF("Slot");
      out.writeByte(0);
      out.writeByte(NbtReader.END);
      out.writeByte(NbtReader.LIST);
      out.writeUTF("Pos");
      out.writeByte(NbtReader.DOUBLE);
      out.writeInt(3);
      out.writeDouble(1.5);
      out.writeDouble(64);
      out.writeDouble(-2.5);
      out.writeByte(NbtReader.COMPOUND);
      out.writeUTF("BukkitValues");
      out.writeByte(NbtReader.STRING);
      out.writeUTF("thestorm:arena_restored_snapshot");
      out.writeUTF("someone-else");
      marker.write(out);
      out.writeByte(NbtReader.END);
      out.writeByte(NbtReader.END);
    }
    return bytes.toByteArray();
  }

  /** What the file holds under {@link #KEY}. */
  @FunctionalInterface
  private interface NbtValue {
    void write(DataOutputStream out) throws IOException;
  }

  private static NbtValue string(String value) {
    return out -> {
      out.writeByte(NbtReader.STRING);
      out.writeUTF(KEY.toString());
      out.writeUTF(value);
    };
  }

  private static final NbtValue NONE = out -> {};

  private Path write(byte[] bytes) throws IOException {
    var directory = Files.createDirectories(level.resolve("players").resolve("data"));
    var file = directory.resolve(ALICE + ".dat");
    Files.write(file, bytes);
    return file;
  }

  @Test
  void theMarkerIsReadFromBukkitValues() throws IOException {
    var file = write(playerFile(string("abc123")));

    assertThat(PaperSavedPlayerData.read(file, KEY)).contains("abc123");
  }

  @Test
  void aFileWithoutTheMarkerAnswersEmpty() throws IOException {
    var file = write(playerFile(NONE));

    assertThat(PaperSavedPlayerData.read(file, KEY)).isEmpty();
  }

  @Test
  void aTruncatedFileIsNotAnAnswer() throws IOException {
    var whole = playerFile(string("abc123"));
    var file = write(Arrays.copyOf(whole, whole.length - 6));

    assertThatThrownBy(() -> PaperSavedPlayerData.read(file, KEY))
        .isInstanceOf(UncheckedIOException.class);
  }

  @Test
  void aFileThatIsNotGzippedNbtIsNotAnAnswer() throws IOException {
    var file = write(new byte[] {1, 2, 3, 4});

    assertThatThrownBy(() -> PaperSavedPlayerData.read(file, KEY))
        .isInstanceOf(UncheckedIOException.class);
  }

  @Test
  void aMarkerThatIsNotAStringBreaksTheContract() throws IOException {
    var file =
        write(
            playerFile(
                out -> {
                  out.writeByte(NbtReader.INT);
                  out.writeUTF(KEY.toString());
                  out.writeInt(7);
                }));

    assertThatThrownBy(() -> PaperSavedPlayerData.read(file, KEY))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void readsRunOnTheComputePoolAndAMissingFileFails() throws IOException {
    Files.writeString(level.resolve("level.dat"), "");
    write(playerFile(string("abc123")));
    var files = PlayerDataFiles.locate(level).orElseThrow();
    var data =
        new PaperSavedPlayerData(
            files, new DirectComputePool(), new SavePacer(new ManualScheduler()));

    assertThat(data.marker(ALICE, KEY).join()).isEqualTo(Optional.of("abc123"));
    assertThatThrownBy(() -> data.marker(UUID.randomUUID(), KEY).join())
        .isInstanceOf(CompletionException.class)
        .hasCauseInstanceOf(UncheckedIOException.class);
  }

  @Test
  void theCurrentLayoutWinsOverTheLegacyOne() throws IOException {
    Files.writeString(level.resolve("level.dat"), "");
    Files.createDirectories(level.resolve("playerdata"));
    assertThat(PlayerDataFiles.locate(level))
        .contains(new PlayerDataFiles(level.resolve("playerdata")));

    Files.createDirectories(level.resolve("players").resolve("data"));
    var found = PlayerDataFiles.locate(level).orElseThrow();

    assertThat(found.directory()).isEqualTo(level.resolve("players").resolve("data"));
    assertThat(found.of(ALICE)).isEqualTo(found.directory().resolve(ALICE + ".dat"));
  }

  @Test
  void aLevelWithNoPlayerDataFolderIsUnavailable() throws IOException {
    assertThat(PlayerDataFiles.locate(level)).isEmpty();
    Files.createDirectories(level.resolve("players"));
    assertThat(PlayerDataFiles.locate(level)).isEmpty();
  }

  @Test
  void aFreshLevelWithoutLevelDatStillHasItsPlayerData() throws IOException {
    Files.createDirectories(level.resolve("players").resolve("data"));

    assertThat(PlayerDataFiles.locate(level))
        .contains(new PlayerDataFiles(level.resolve("players").resolve("data")));
  }

  @Test
  void unavailablePlayerDataRefusesToSaveOrRead() {
    assertThat(SavedPlayerData.UNAVAILABLE.available()).isFalse();
    assertThat(SavedPlayerData.UNAVAILABLE.marker(ALICE, KEY)).isCompletedExceptionally();
  }
}
