package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;

/** The schematic reader round-trips the writer and rejects what a map must not contain. */
final class SchematicReaderTest {

  private static Schematic sample() {
    var indices = new int[2 * 3 * 4];
    for (var i = 0; i < indices.length; i++) {
      indices[i] = i % 3;
    }
    return new Schematic(
        new Schematic.Dimensions(2, 3, 4),
        List.of("minecraft:air", "minecraft:stone", "minecraft:tnt"),
        indices);
  }

  @Test
  void roundTripsThroughGzippedNbt() {
    var schematic = sample();

    var read = SchematicReader.read(new ByteArrayInputStream(SchematicWriter.write(schematic)));

    assertThat(read.size()).isEqualTo(schematic.size());
    assertThat(read.palette()).isEqualTo(schematic.palette());
    assertThat(read.sha256()).isEqualTo(schematic.sha256());
    assertThat(read.blockState(1, 2, 3)).isEqualTo(schematic.blockState(1, 2, 3));
  }

  @Test
  void indicesRunYThenZThenX() {
    var schematic = sample();

    assertThat(schematic.index(0, 0, 0)).isZero();
    assertThat(schematic.index(1, 0, 0)).isEqualTo(1);
    assertThat(schematic.index(0, 0, 1)).isEqualTo(2);
    assertThat(schematic.index(0, 1, 0)).isEqualTo(8);
  }

  @Test
  void varintsDecodeWideIndices() {
    assertThat(SchematicReader.varints(new byte[] {0x7F, (byte) 0x80, 0x01, 0x00}, 3))
        .containsExactly(127, 128, 0);
    assertThatThrownBy(() -> SchematicReader.varints(new byte[] {0x7F, 0x00}, 1))
        .hasMessageContaining("beyond the last block");
    assertThatThrownBy(() -> SchematicReader.varints(new byte[] {(byte) 0x80}, 1))
        .hasMessageContaining("ends after");
  }

  @Test
  void theHashChangesWithAnyBlockOrPaletteChange() {
    var a = sample();
    var moved = new int[2 * 3 * 4];
    for (var i = 0; i < moved.length; i++) {
      moved[i] = (i + 1) % 3;
    }
    var b = new Schematic(a.size(), a.palette(), moved);
    var c =
        new Schematic(
            a.size(), List.of("minecraft:air", "minecraft:stone", "minecraft:dirt"), moved);

    assertThat(a.sha256()).isNotEqualTo(b.sha256());
    assertThat(b.sha256()).isNotEqualTo(c.sha256());
    assertThat(a.sha256()).matches("[0-9a-f]{64}");
  }

  @Test
  void blockEntitiesAreRefused() {
    var bytes = withBlockEntity();

    assertThatThrownBy(() -> SchematicReader.read(new ByteArrayInputStream(bytes)))
        .hasMessageContaining("block entities");
  }

  @Test
  void otherVersionsAreRefused() {
    var bytes = version(2);

    assertThatThrownBy(() -> SchematicReader.read(new ByteArrayInputStream(bytes)))
        .hasMessageContaining("version 2");
  }

  @Test
  void garbageIsRefused() {
    assertThatThrownBy(() -> SchematicReader.read(new ByteArrayInputStream(new byte[] {1, 2, 3})))
        .isInstanceOf(UncheckedIOException.class);
  }

  /** A one-block schematic whose Blocks compound lists one block entity. */
  private static byte[] withBlockEntity() {
    return nbt(
        out -> {
          out.writeByte(Nbt.COMPOUND);
          out.writeUTF("");
          out.writeByte(Nbt.COMPOUND);
          out.writeUTF("Schematic");
          integer(out, "Version", 3);
          shortTag(out, "Width", 1);
          shortTag(out, "Height", 1);
          shortTag(out, "Length", 1);
          out.writeByte(Nbt.COMPOUND);
          out.writeUTF("Blocks");
          out.writeByte(Nbt.COMPOUND);
          out.writeUTF("Palette");
          integer(out, "minecraft:chest", 0);
          out.writeByte(Nbt.END);
          out.writeByte(Nbt.BYTE_ARRAY);
          out.writeUTF("Data");
          out.writeInt(1);
          out.write(0);
          out.writeByte(Nbt.LIST);
          out.writeUTF("BlockEntities");
          out.writeByte(Nbt.COMPOUND);
          out.writeInt(1);
          out.writeByte(Nbt.END);
          out.writeByte(Nbt.END);
          out.writeByte(Nbt.END);
          out.writeByte(Nbt.END);
        });
  }

  private static byte[] version(int version) {
    return nbt(
        out -> {
          out.writeByte(Nbt.COMPOUND);
          out.writeUTF("");
          out.writeByte(Nbt.COMPOUND);
          out.writeUTF("Schematic");
          integer(out, "Version", version);
          out.writeByte(Nbt.END);
          out.writeByte(Nbt.END);
        });
  }

  private interface Body {
    void write(DataOutputStream out) throws IOException;
  }

  private static byte[] nbt(Body body) {
    var bytes = new ByteArrayOutputStream();
    try (var out = new DataOutputStream(new GZIPOutputStream(bytes))) {
      body.write(out);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return bytes.toByteArray();
  }

  private static void integer(DataOutputStream out, String name, int value) throws IOException {
    out.writeByte(Nbt.INT);
    out.writeUTF(name);
    out.writeInt(value);
  }

  private static void shortTag(DataOutputStream out, String name, int value) throws IOException {
    out.writeByte(Nbt.SHORT);
    out.writeUTF(name);
    out.writeShort(value);
  }
}
