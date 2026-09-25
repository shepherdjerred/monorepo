package com.shepherdjerred.thestorm.npcs.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentRules;
import com.shepherdjerred.thestorm.npcs.domain.movement.MovementSettings;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The shipped {@code npcs.yml} and {@code npcs/*.yml} parse and validate. */
final class ShippedContentTest {

  static final Path OWNED = Path.of("../../../server/owned/plugins/TheStorm");

  static final ContentRules RULES =
      new ContentRules(
          Set.of("minecraft:overworld"),
          Arrays.stream(Track.values()).map(Track::id).collect(Collectors.toUnmodifiableSet()));

  private static Content shipped() {
    return ContentLoader.load(OWNED, RULES)
        .fold(
            content -> content,
            problems -> {
              throw new AssertionError(problems.toString());
            });
  }

  @Test
  void theShippedConfigParses() {
    var config = ConfigFiles.load(OWNED.resolve("npcs.yml"), NpcsConfig.class);
    assertThat(config.movement().speed()).isLessThanOrEqualTo(MovementSettings.MAX_SPEED);
    assertThat(config.navigator().entity()).isEqualTo("minecraft:llama");
    assertThat(config.markers().available()).isEqualTo("!");
    assertThat(config.markers().turnIn()).isEqualTo("?");
  }

  @Test
  void theShippedContentValidates() {
    var content = shipped();
    assertThat(content.npcs().keySet())
        .containsExactlyInAnyOrder(
            "stan", "darren", "zavier", "lynn", "aldric", "braxton", "nat", "thomas");
    assertThat(content.chunks()).isNotEmpty();
  }

  @Test
  void everyTrackHasATrainerWhoseDialogueOpensIt() {
    var content = shipped();
    var trainers =
        content.npcs().values().stream()
            .filter(npc -> npc.trainer().isPresent())
            .collect(
                Collectors.toUnmodifiableMap(
                    npc -> npc.trainer().orElseThrow(), NpcDefinition::id));
    assertThat(trainers)
        .isEqualTo(
            Map.of(
                "shopkeeper", "stan",
                "mechanic", "darren",
                "engineer", "zavier",
                "spellcaster", "lynn",
                "governor", "aldric"));
    for (var id : trainers.values()) {
      var npc = content.npc(id).orElseThrow();
      assertThat(npc.roles()).contains("trainer");
      var dialogue = content.dialogue(npc).orElseThrow();
      assertThat(dialogue.nodes().values())
          .anySatisfy(
              node ->
                  assertThat(node.options())
                      .anyMatch(option -> option.effect() instanceof OptionEffect.OpenTrainer));
    }
  }

  @Test
  void theBankerHasARoleAndNothingElse() {
    var braxton = shipped().npc("braxton").orElseThrow();
    assertThat(braxton.roles()).containsExactly("banker");
    assertThat(braxton.dialogue()).isEmpty();
    assertThat(braxton.trainer()).isEmpty();
  }

  @Test
  void theSampleSchedulesAreUsed() {
    var content = shipped();
    assertThat(content.schedule(content.npc("nat").orElseThrow()).orElseThrow().id())
        .isEqualTo("tavern-keeper");
    var smith = content.schedule(content.npc("thomas").orElseThrow()).orElseThrow();
    assertThat(smith.shelter()).contains("smithy-door");
  }

  @Test
  void aMissingFolderIsAProblem(@TempDir Path empty) {
    var problems =
        problems(ContentLoader.load(empty, RULES).fold(content -> List.of(), found -> found));
    assertThat(problems).singleElement().asString().contains("cannot list NPC content");
  }

  @Test
  void strictParsingReportsTheFileAndPath(@TempDir Path data) throws IOException {
    var folder = Files.createDirectories(data.resolve(ContentLoader.DIRECTORY));
    Files.writeString(
        folder.resolve("a.yml"), "places: {}\nskins: {}\nschedules: {}\ndialogues: {}\nnpcs: {}\n");
    Files.writeString(
        folder.resolve("b.yml"), "places: {}\nskins: {}\nschedules: {}\ndialogues: {}\n");
    Files.writeString(folder.resolve("notes.txt"), "not content");
    var problems =
        problems(ContentLoader.load(data, RULES).fold(content -> List.of(), found -> found));
    assertThat(problems)
        .singleElement()
        .satisfies(
            problem -> {
              assertThat(problem.source()).isEqualTo("npcs/b.yml");
              assertThat(problem.message()).contains("npcs");
            });
  }

  @Test
  void anEmptyFolderMeansNoNpcs(@TempDir Path data) throws IOException {
    Files.createDirectories(data.resolve(ContentLoader.DIRECTORY));
    assertThat(ContentLoader.load(data, RULES).isOk()).isTrue();
  }

  @Test
  void configRecordsRejectBadValues() {
    assertThatThrownBy(() -> new NpcsConfig.Animation(4, 2, 20))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new NpcsConfig.Navigator("llama", 48))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new NpcsConfig.Markers("", "?", 2.3))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new NpcsConfig.Dialog("Continue", 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static List<ContentProblem> problems(List<ContentProblem> problems) {
    return problems;
  }
}
