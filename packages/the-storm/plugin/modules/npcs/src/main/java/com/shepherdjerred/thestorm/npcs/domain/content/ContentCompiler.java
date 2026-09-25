package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.SkinEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.SpotEntry;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/**
 * Validates the NPC content files together into {@link Content}. Every problem in every file is
 * reported at once, each at its path; content with any problem is rejected whole.
 */
public final class ContentCompiler {

  private final ContentRules rules;
  private final Problems problems = new Problems();

  private ContentCompiler(ContentRules rules) {
    this.rules = rules;
  }

  /** A parsed file and where it came from. */
  public record Sourced(String source, ContentFile file) {}

  /** One entry of a section, with the file it came from. */
  record Located<T>(String source, String section, String id, T entry) {

    String path(String... rest) {
      var path = new StringBuilder(section).append('.').append(id);
      for (var part : rest) {
        path.append('.').append(part);
      }
      return path.toString();
    }
  }

  public static Result<Content, List<ContentProblem>> compile(
      List<Sourced> files, ContentRules rules) {
    return new ContentCompiler(rules).run(files);
  }

  private Result<Content, List<ContentProblem>> run(List<Sourced> files) {
    var placeEntries = merge(files, "places", ContentFile::places);
    var skinEntries = merge(files, "skins", ContentFile::skins);
    var scheduleEntries = merge(files, "schedules", ContentFile::schedules);
    var dialogueEntries = merge(files, "dialogues", ContentFile::dialogues);
    var npcEntries = merge(files, "npcs", ContentFile::npcs);

    var places = compilePlaces(placeEntries);
    var skins = compileSkins(skinEntries);
    var schedules = new LinkedHashMap<String, Schedule>();
    for (var entry : scheduleEntries.values()) {
      new ScheduleCompiler(problems, placeEntries.keySet(), entry)
          .compile()
          .ifPresent(s -> schedules.put(s.id(), s));
    }
    var dialogues = new LinkedHashMap<String, DialogueGraph>();
    for (var entry : dialogueEntries.values()) {
      new DialogueCompiler(problems, entry).compile().ifPresent(d -> dialogues.put(d.id(), d));
    }
    var npcs = new LinkedHashMap<String, NpcDefinition>();
    var references =
        new NpcCompiler.References(
            rules,
            places,
            skins,
            schedules,
            dialogues,
            scheduleEntries.keySet(),
            dialogueEntries.keySet());
    for (var entry : npcEntries.values()) {
      new NpcCompiler(problems, references, entry).compile().ifPresent(n -> npcs.put(n.id(), n));
    }
    if (!problems.isEmpty()) {
      return Result.err(problems.all());
    }
    return Result.ok(new Content(npcs, dialogues, schedules, places));
  }

  private <T> Map<String, Located<T>> merge(
      List<Sourced> files, String section, Function<ContentFile, Map<String, T>> read) {
    var merged = new LinkedHashMap<String, Located<T>>();
    for (var file : files) {
      read.apply(file.file())
          .forEach(
              (id, entry) -> {
                var located = new Located<>(file.source(), section, id, entry);
                if (!Ids.valid(id)) {
                  problems.add(located, "", Ids.RULE);
                  return;
                }
                var previous = merged.putIfAbsent(id, located);
                if (previous != null) {
                  problems.add(located, "", "duplicate id; also defined in " + previous.source());
                }
              });
    }
    return merged;
  }

  private Map<String, Spot> compilePlaces(Map<String, Located<SpotEntry>> entries) {
    var places = new HashMap<String, Spot>();
    for (var located : entries.values()) {
      if (located.id().equals(NpcBrain.HOME)) {
        problems.add(located, "", "home is reserved: it always means the NPC's own home");
        continue;
      }
      spot(problems, rules, located, new Nested<>("", located.entry()))
          .ifPresent(spot -> places.put(located.id(), spot));
    }
    return places;
  }

  private Map<String, Skin.Signed> compileSkins(Map<String, Located<SkinEntry>> entries) {
    var skins = new HashMap<String, Skin.Signed>();
    for (var located : entries.values()) {
      var entry = located.entry();
      problems
          .attempt(
              located, "", () -> new Skin.Signed(located.id(), entry.value(), entry.signature()))
          .ifPresent(skin -> skins.put(located.id(), skin));
    }
    return skins;
  }

  /** Validates a spot entry at {@code path} inside {@code located} (empty for the entry itself). */
  static Optional<Spot> spot(
      Problems problems, ContentRules rules, Located<?> located, Nested<SpotEntry> entry) {
    if (!rules.worlds().contains(entry.value().world())) {
      problems.add(
          located,
          entry.path(),
          "world "
              + entry.value().world()
              + " is not loaded; loaded worlds: "
              + sorted(rules.worlds()));
      return Optional.empty();
    }
    var value = entry.value();
    return problems.attempt(
        located,
        entry.path(),
        () ->
            new Spot(
                value.world(),
                new Vec3(value.x(), value.y(), value.z()),
                new Rotation(value.yaw(), value.pitch())));
  }

  /** A value found at {@code path} inside an entry; the path is empty for the entry itself. */
  record Nested<T>(String path, T value) {}

  static String sorted(Collection<String> values) {
    return values.stream().sorted().toList().toString();
  }
}
