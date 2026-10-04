package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Chat;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Broken personality files stop the module with a message that says what is wrong. */
final class PersonalityFilesTest {

  private static final String GOOD =
      """
      id: ash-42
      name: Ash_42
      skin:
        value: ewogICJ0aW1lc3RhbXAiIDogMQp9
        signature: c2lnbmF0dXJl
      skill: 0.62
      leverOffsets:
        reactionMs: 0.8
        aimErrorDeg: -0.4
      kits:
        trooper: 1
        longbow: 0.35
      roles:
        plant: 1
        escort: 0.6
      style:
        aggression: 0.7
        patience: 0.3
        teamplay: 0.55
        risk: 0.6
      chat:
        tone: [dry, hype]
        verbosity: terse
        catchphrases:
          - gg
          - "that one's on me"
      bio: Pushes first and asks questions later.
      batch: 1
      retired: false
      """;

  @TempDir Path directory;

  private void write(String file, String yaml) throws IOException {
    Files.writeString(directory.resolve(file), yaml);
  }

  @Test
  void aWellFormedFileLoads() throws IOException {
    write("ash-42.yml", GOOD);

    var catalog = PersonalityFiles.loadDirectory(directory);

    assertThat(catalog.all()).hasSize(1);
    var ash = catalog.byId("ash-42").orElseThrow();
    assertThat(ash.name()).isEqualTo("Ash_42");
    assertThat(ash.skinValue()).isEqualTo("ewogICJ0aW1lc3RhbXAiIDogMQp9");
    assertThat(ash.skill()).isEqualTo(0.62);
    assertThat(ash.leverOffsets().z(Lever.REACTION_MS)).isEqualTo(0.8);
    assertThat(ash.leverOffsets().z(Lever.CPS)).isZero();
    assertThat(ash.kits()).containsEntry(Kit.LONGBOW, 0.35).containsKey(Kit.TROOPER);
    assertThat(ash.roles()).containsOnlyKeys(Role.PLANT, Role.ESCORT);
    assertThat(ash.style().aggression()).isEqualTo(0.7);
    assertThat(ash.chat().verbosity()).isEqualTo(Chat.Verbosity.TERSE);
    assertThat(ash.chat().catchphrases()).containsExactly("gg", "that one's on me");
    assertThat(ash.batch()).isEqualTo(1);
    assertThat(ash.retired()).isFalse();
    assertThat(catalog.active()).hasSize(1);
  }

  @Test
  void loadResolvesTheContentDirectoryUnderTheDataFolder() throws IOException {
    var content = directory.resolve(PersonalityFiles.DIRECTORY);
    Files.createDirectories(content);
    Files.writeString(content.resolve("ash-42.yml"), GOOD);

    assertThat(PersonalityFiles.load(directory).all()).hasSize(1);
  }

  @Test
  void unknownKeysAreErrors() throws IOException {
    write("ash-42.yml", GOOD.replace("retired: false", "retired: false\nfavouriteColour: red"));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("ash-42.yml")
        .hasMessageContaining("favouriteColour");
  }

  @Test
  void aNameLongerThanSixteenCharactersIsAnError() throws IOException {
    write("ash-42.yml", GOOD.replace("name: Ash_42", "name: Ash_42_the_undefeated"));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Ash_42_the_undefeated")
        .hasMessageContaining("3..16");
  }

  @Test
  void aDuplicateNameAcrossFilesIsAnError() throws IOException {
    write("ash-42.yml", GOOD);
    write(
        "ember.yml",
        GOOD.replace("id: ash-42", "id: ember").replace("name: Ash_42", "name: ash_42"));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("duplicate personality name");
  }

  @Test
  void namesOneEditApartAreAnError() throws IOException {
    write("ash-42.yml", GOOD);
    write(
        "ash-43.yml",
        GOOD.replace("id: ash-42", "id: ash-43").replace("name: Ash_42", "name: Ash_43"));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("too similar");
  }

  @Test
  void aMissingSkinIsAnError() throws IOException {
    write(
        "ash-42.yml",
        GOOD.replace(
            "skin:\n  value: ewogICJ0aW1lc3RhbXAiIDogMQp9\n  signature: c2lnbmF0dXJl\n", ""));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("skin");
  }

  @Test
  void aBlankSkinSignatureIsAnError() throws IOException {
    write("ash-42.yml", GOOD.replace("signature: c2lnbmF0dXJl", "signature: \"  \""));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("skin value and signature must not be blank");
  }

  @Test
  void theFileNameMustBeTheId() throws IOException {
    write("ash.yml", GOOD);

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("name the file ash-42.yml");
  }

  @Test
  void unknownLeversKitsRolesAndVerbosityAreErrors() throws IOException {
    write("ash-42.yml", GOOD.replace("reactionMs: 0.8", "charisma: 0.8"));
    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .hasMessageContaining("unknown lever: charisma");

    write("ash-42.yml", GOOD.replace("longbow: 0.35", "crossbow: 0.35"));
    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .hasMessageContaining("unknown kit: crossbow");

    write("ash-42.yml", GOOD.replace("escort: 0.6", "sniper: 0.6"));
    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .hasMessageContaining("unknown role: sniper");

    write("ash-42.yml", GOOD.replace("verbosity: terse", "verbosity: TERSE"));
    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .hasMessageContaining("unknown verbosity: TERSE");
  }

  @Test
  void everyBrokenFileIsReportedAtOnce() throws IOException {
    write("ash-42.yml", GOOD.replace("skill: 0.62", "skill: 1.5"));
    write("ember.yml", GOOD.replace("id: ash-42", "id: ember").replace("name: Ash_42", "name: ab"));

    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .hasMessageContaining("ash-42.yml")
        .hasMessageContaining("skill must be 0..1")
        .hasMessageContaining("ember.yml")
        .hasMessageContaining("'ab'");
  }

  @Test
  void anEmptyDirectoryIsAnError() {
    assertThatThrownBy(() -> PersonalityFiles.loadDirectory(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("no personalities");
  }
}
