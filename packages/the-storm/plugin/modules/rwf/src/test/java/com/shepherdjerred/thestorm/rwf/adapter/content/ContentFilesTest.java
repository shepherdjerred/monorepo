package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.block.data.BlockData;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;

/** The loader refuses every inconsistency between the files, and between the files and the code. */
final class ContentFilesTest {

  @TempDir Path directory;

  private static final Function<String, BlockData> PARSER = Bukkit::createBlockData;

  @BeforeAll
  static void mock() {
    MockBukkit.mock();
  }

  @AfterAll
  static void unmock() {
    MockBukkit.unmock();
  }

  private Path shippedCopy() {
    copy("rwf.yml");
    copy("rwf/kits.yml");
    copy("rwf/maps/training-yard/map.yml");
    copy("rwf/maps/training-yard/blocks.schem");
    copy("rwf/maps/training-yard/details.json");
    copy("rwf/lobby/lobby.yml");
    copy("rwf/lobby/blocks.schem");
    return directory;
  }

  private void copy(String file) {
    try {
      var target = directory.resolve(file);
      Files.createDirectories(target.getParent());
      Files.copy(ShippedContentTest.SHIPPED.resolve(file), target);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private void edit(String file, String regex, String replacement) {
    try {
      var path = directory.resolve(file);
      var text = Files.readString(path);
      var edited = Pattern.compile(regex).matcher(text).replaceFirst(replacement);
      assertThat(edited).as("the edit changed %s", file).isNotEqualTo(text);
      Files.writeString(path, edited);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Test
  void theShippedFilesLoad() {
    var content = ContentFiles.load(shippedCopy(), PARSER);

    assertThat(content.maps()).extracting(LoadedMap::id).containsExactly("training-yard");
  }

  @Test
  void runtimeCatalogDefersTerrainDecodingButStillRejectsItBeforePlay() throws IOException {
    shippedCopy();
    Files.write(directory.resolve("rwf/maps/training-yard/blocks.schem"), new byte[] {1, 2, 3});
    var catalog = ContentFiles.catalog(directory, PARSER);
    assertThat(catalog.maps()).extracting(MapSource::id).containsExactly("training-yard");
    assertThatThrownBy(() -> catalog.maps().getFirst().load()).hasMessageContaining("blocks.schem");
  }

  @Test
  void runtimeCatalogDefersDetailsAndRejectsMissingOrCorruptPayloadsBeforePlay()
      throws IOException {
    shippedCopy();
    var details = directory.resolve("rwf/maps/training-yard/details.json");
    Files.writeString(details, "{\"version\":1,\"unexpected\":true}");
    var catalog = ContentFiles.catalog(directory, PARSER);
    assertThatThrownBy(() -> catalog.maps().getFirst().load()).hasMessageContaining("details.json");
    Files.delete(details);
    assertThatThrownBy(() -> ContentFiles.catalog(directory, PARSER))
        .hasMessageContaining("details.json")
        .hasMessageContaining("is missing");
  }

  @Test
  void runtimeCatalogRequiresEveryTerrainFileAndRejectsMetadataChanges() throws IOException {
    shippedCopy();
    var catalog = ContentFiles.catalog(directory, PARSER);
    edit("rwf/maps/training-yard/map.yml", "name: Training Yard", "name: Changed Yard");
    assertThatThrownBy(() -> catalog.maps().getFirst().load())
        .hasMessageContaining("changed after the catalog was loaded");
    Files.delete(directory.resolve("rwf/maps/training-yard/blocks.schem"));
    assertThatThrownBy(() -> ContentFiles.catalog(directory, PARSER))
        .hasMessageContaining("blocks.schem")
        .hasMessageContaining("is missing");
  }

  @Test
  void aKitThatDisagreesWithTheKitBookIsRefused() {
    shippedCopy();
    edit("rwf/kits.yml", "sharpness: 1", "sharpness: 2");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("trooper");
  }

  @Test
  void aMissingKitIsRefused() {
    shippedCopy();
    edit("rwf/kits.yml", "(?s)  - id: rewind.*", "");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("kits.yml lists");
  }

  @Test
  void aPinnedRuleThatDisagreesWithTheCodeIsRefused() {
    shippedCopy();
    edit("rwf.yml", "fuseSeconds: 60", "fuseSeconds: 45");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("fuseSeconds");
  }

  @Test
  void aMapFolderNamedUnlikeItsIdIsRefused() throws IOException {
    shippedCopy();
    Files.move(directory.resolve("rwf/maps/training-yard"), directory.resolve("rwf/maps/yard"));

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("name it training-yard");
  }

  @Test
  void aWrongBlockHashIsRefused() {
    shippedCopy();
    edit("rwf/maps/training-yard/map.yml", "blocksSha256: 03f6", "blocksSha256: 0000");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("blocksSha256");
  }

  @Test
  void aBombNotStandingOnTntIsRefused() {
    shippedCopy();
    edit(
        "rwf/maps/training-yard/map.yml",
        "id: red-1, team: RED, at: \\{ x: 8, y: 65, z: 31 \\}",
        "id: red-1, team: RED, at: { x: 9, y: 65, z: 31 }");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("red-1")
        .hasMessageContaining("not TNT");
  }

  @Test
  void aMissingTeamBombIsRefusedWhenTheMapHasNoNuke() {
    shippedCopy();
    edit("rwf/maps/training-yard/map.yml", "(?m)^  - \\{ id: blue-1.*\\n", "");
    edit("rwf/maps/training-yard/map.yml", "(?m)^  - \\{ id: nuke-1.*\\n", "");
    edit("rwf/maps/training-yard/map.yml", "(?m)^nukes:$", "nukes: []");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("Blue Team does not have a bomb set");
  }

  @Test
  void aPaletteEntryTheServerDoesNotKnowIsRefused() throws IOException {
    shippedCopy();
    var bad =
        new Schematic(
            new Schematic.Dimensions(64, 16, 64),
            List.of("minecraft:air", "minecraft:not_a_block"),
            new int[64 * 16 * 64]);
    Files.write(
        directory.resolve("rwf/maps/training-yard/blocks.schem"), SchematicWriter.write(bad));

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .hasMessageContaining("unknown block state")
        .hasMessageContaining("minecraft:not_a_block");
  }

  @Test
  void aSchematicOfAnotherSizeIsRefused() throws IOException {
    shippedCopy();
    var small =
        new Schematic(new Schematic.Dimensions(2, 2, 2), List.of("minecraft:air"), new int[8]);
    Files.write(
        directory.resolve("rwf/maps/training-yard/blocks.schem"), SchematicWriter.write(small));

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER)).hasMessageContaining("2x2x2");
  }

  @Test
  void anUnknownKeyIsRefused() {
    shippedCopy();
    edit("rwf.yml", "world: rwf", "world: rwf\nextra: 1");

    assertThatThrownBy(() -> ContentFiles.load(directory, PARSER))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("extra");
  }
}
