package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler.Located;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.NpcEntry;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Validates one NPC entry against everything it refers to. */
final class NpcCompiler {

  /** The longest name; longer names crowd the screen above the NPC. */
  static final int MAX_NAME = 48;

  /** The longest description. */
  static final int MAX_DESCRIPTION = 64;

  private static final String VANILLA = "vanilla:";

  /**
   * What an NPC may refer to.
   *
   * @param scheduleIds every schedule id defined, even ones that failed validation, so a broken
   *     schedule is reported once rather than again by each NPC using it
   * @param dialogueIds likewise for dialogues
   */
  record References(
      ContentRules rules,
      Map<String, Spot> places,
      Map<String, Skin.Signed> skins,
      Map<String, Schedule> schedules,
      Map<String, DialogueGraph> dialogues,
      Set<String> scheduleIds,
      Set<String> dialogueIds) {}

  private final Problems problems;
  private final References references;
  private final Located<NpcEntry> located;
  private boolean failed;

  NpcCompiler(Problems problems, References references, Located<NpcEntry> located) {
    this.problems = problems;
    this.references = references;
    this.located = located;
  }

  Optional<NpcDefinition> compile() {
    var entry = located.entry();
    text(entry.name(), "name", MAX_NAME, false);
    text(entry.description(), "description", MAX_DESCRIPTION, true);
    var skin = skin(entry.skin());
    var home =
        ContentCompiler.spot(
            problems,
            references.rules(),
            located,
            new ContentCompiler.Nested<>("home", entry.home()));
    if (home.isEmpty()) {
      failed = true;
    }
    var pose = NpcPose.byId(entry.pose());
    if (pose.isEmpty()) {
      fail(
          "pose",
          "pose must be one of " + Arrays.stream(NpcPose.values()).map(NpcPose::id).toList());
    }
    var roles = roles(entry);
    var schedule = reference(entry.schedule(), "schedule", references.scheduleIds());
    var dialogue = reference(entry.dialogue(), "dialogue", references.dialogueIds());
    var trainer = trainer(entry.trainer());
    if (failed || skin.isEmpty() || home.isEmpty() || pose.isEmpty()) {
      return Optional.empty();
    }
    dialogue
        .map(references.dialogues()::get)
        .ifPresent(graph -> checkTrainerDialogue(graph, trainer));
    schedule.map(references.schedules()::get).ifPresent(plan -> checkSameWorld(plan, home.get()));
    if (failed) {
      return Optional.empty();
    }
    return Optional.of(
        new NpcDefinition(
            located.id(),
            entry.name(),
            entry.description(),
            skin.get(),
            home.get(),
            pose.get(),
            roles,
            schedule,
            dialogue,
            trainer));
  }

  private void text(String value, String path, int max, boolean mayBeBlank) {
    if (value.length() > max || (!mayBeBlank && value.isBlank())) {
      fail(path, path + " must be " + (mayBeBlank ? 0 : 1) + ".." + max + " characters");
    }
  }

  private Optional<Skin> skin(String reference) {
    if (Ids.NONE.equals(reference)) {
      return Optional.of(new Skin.Default());
    }
    if (reference.startsWith(VANILLA)) {
      return vanilla(reference.substring(VANILLA.length()));
    }
    var signed = references.skins().get(reference);
    if (signed == null) {
      fail(
          "skin",
          "skin must be none, vanilla:<wide|slim>/<name> or a skin id under skins: " + reference);
      return Optional.empty();
    }
    return Optional.of(signed);
  }

  private Optional<Skin> vanilla(String spec) {
    var parts = spec.split("/", -1);
    var model =
        parts.length == 2
            ? Arrays.stream(Skin.Model.values()).filter(m -> m.id().equals(parts[0])).findFirst()
            : Optional.<Skin.Model>empty();
    if (model.isEmpty()) {
      fail("skin", "write vanilla:wide/<name> or vanilla:slim/<name>: vanilla:" + spec);
      return Optional.empty();
    }
    var skin =
        problems.attempt(
            located,
            "skin",
            () -> new Skin.Vanilla(model.get(), parts[1].toLowerCase(Locale.ROOT)));
    if (skin.isEmpty()) {
      failed = true;
    }
    return skin.map(Skin.class::cast);
  }

  private Set<String> roles(NpcEntry entry) {
    var roles = new LinkedHashSet<String>();
    for (var role : entry.roles()) {
      if (!Ids.valid(role)) {
        fail("roles", "role " + role + ": " + Ids.RULE);
      } else if (!roles.add(role)) {
        fail("roles", "role " + role + " is listed twice");
      }
    }
    return roles;
  }

  private Optional<String> reference(String value, String path, Set<String> known) {
    if (Ids.NONE.equals(value)) {
      return Optional.empty();
    }
    if (!known.contains(value)) {
      fail(path, path + " " + value + " is not defined; write none for no " + path);
    }
    return Optional.of(value);
  }

  private Optional<String> trainer(String value) {
    if (Ids.NONE.equals(value)) {
      return Optional.empty();
    }
    if (!references.rules().trainerTracks().contains(value)) {
      fail(
          "trainer",
          "trainer must be none or a track: "
              + ContentCompiler.sorted(references.rules().trainerTracks()));
    }
    return Optional.of(value);
  }

  private void checkTrainerDialogue(DialogueGraph graph, Optional<String> trainer) {
    var opensTrainer =
        graph.nodes().values().stream()
            .flatMap(node -> node.options().stream())
            .anyMatch(option -> option.effect() instanceof OptionEffect.OpenTrainer);
    if (opensTrainer && trainer.isEmpty()) {
      fail("dialogue", "dialogue " + graph.id() + " opens a trainer, but this NPC trains no track");
    }
  }

  private void checkSameWorld(Schedule schedule, Spot home) {
    var names = new LinkedHashSet<String>();
    schedule.shelter().ifPresent(names::add);
    schedule.slots().forEach(slot -> names.addAll(slot.activity().places()));
    for (var name : names) {
      var spot = NpcBrain.HOME.equals(name) ? home : references.places().get(name);
      if (spot != null && !spot.world().equals(home.world())) {
        fail(
            "schedule",
            "schedule "
                + schedule.id()
                + " sends this NPC to "
                + name
                + " in "
                + spot.world()
                + ", but it lives in "
                + home.world());
      }
    }
  }

  private void fail(String path, String message) {
    failed = true;
    problems.add(located, path, message);
  }
}
