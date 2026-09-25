package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.geo.ChunkKey;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Activity;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** All NPC content, validated: every reference resolves. */
public record Content(
    Map<String, NpcDefinition> npcs,
    Map<String, DialogueGraph> dialogues,
    Map<String, Schedule> schedules,
    Map<String, Spot> places) {

  /** How far past a place's own spot an NPC may step: arriving, rounding a corner. */
  static final double PLACE_MARGIN = 2;

  public Content {
    npcs = Map.copyOf(npcs);
    dialogues = Map.copyOf(dialogues);
    schedules = Map.copyOf(schedules);
    places = Map.copyOf(places);
  }

  /** No content at all. */
  public static Content empty() {
    return new Content(Map.of(), Map.of(), Map.of(), Map.of());
  }

  /** The NPCs sorted by id. */
  public List<NpcDefinition> sortedNpcs() {
    return npcs.values().stream().sorted(Comparator.comparing(NpcDefinition::id)).toList();
  }

  public Optional<NpcDefinition> npc(String id) {
    return Optional.ofNullable(npcs.get(id));
  }

  /** {@code npc}'s schedule, if it has one. */
  public Optional<Schedule> schedule(NpcDefinition npc) {
    return npc.schedule().map(this::requireSchedule);
  }

  /** {@code npc}'s own dialogue, if it has one. */
  public Optional<DialogueGraph> dialogue(NpcDefinition npc) {
    return npc.dialogue().map(this::requireDialogue);
  }

  /**
   * Every chunk an NPC may stand in: its home, and every place its schedule names, widened by the
   * wander radius. These are kept loaded so NPCs are always there to be reconciled and walked.
   */
  public Set<ChunkKey> chunks() {
    var chunks = new LinkedHashSet<ChunkKey>();
    for (var npc : sortedNpcs()) {
      chunks.addAll(ChunkKey.around(npc.home().world(), npc.home().position(), PLACE_MARGIN));
      schedule(npc).ifPresent(schedule -> chunks.addAll(scheduleChunks(npc, schedule)));
    }
    return chunks;
  }

  private Set<ChunkKey> scheduleChunks(NpcDefinition npc, Schedule schedule) {
    var chunks = new LinkedHashSet<ChunkKey>();
    schedule.shelter().ifPresent(shelter -> chunks.addAll(around(npc, shelter, PLACE_MARGIN)));
    for (var slot : schedule.slots()) {
      var reach =
          slot.activity() instanceof Activity.Wander(var _, var radius)
              ? radius + PLACE_MARGIN
              : PLACE_MARGIN;
      slot.activity().places().forEach(place -> chunks.addAll(around(npc, place, reach)));
    }
    return chunks;
  }

  private Set<ChunkKey> around(NpcDefinition npc, String place, double reach) {
    var spot = NpcBrain.HOME.equals(place) ? npc.home() : places.get(place);
    if (spot == null) {
      throw new IllegalStateException("validated content lost place " + place);
    }
    return ChunkKey.around(spot.world(), spot.position(), reach);
  }

  private Schedule requireSchedule(String id) {
    var schedule = schedules.get(id);
    if (schedule == null) {
      throw new IllegalStateException("validated content lost schedule " + id);
    }
    return schedule;
  }

  private DialogueGraph requireDialogue(String id) {
    var dialogue = dialogues.get(id);
    if (dialogue == null) {
      throw new IllegalStateException("validated content lost dialogue " + id);
    }
    return dialogue;
  }
}
