package com.shepherdjerred.thestorm.quests.domain.storylet;

import static java.util.Comparator.comparingInt;

import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.util.ArrayList;
import java.util.List;

/**
 * Picks the NPC's next quest offers. Requirements and repeat cooldowns come from the quest engine;
 * salience keeps story and track progression visible, while a stable weighted draw rotates offers
 * within one salience band. A player sees the same menu throughout their local day.
 */
public final class Storylets {

  private Storylets() {}

  /** An eligible offer and its selection policy. Higher salience wins; weight breaks ties. */
  public record Candidate(Quest quest, int salience, int weight) {
    public Candidate {
      if (weight < 1) {
        throw new IllegalArgumentException("storylet weight must be positive");
      }
    }
  }

  /** The currently offerable quests at {@code npc}, in the order they should be shown. */
  public static List<Quest> offers(PlayerQuests state, String npc, Context context, int limit) {
    var candidates =
        context.catalog().all().stream()
            .filter(quest -> quest.giver().equals(npc))
            .filter(quest -> quest.category() != Quest.Category.HIDDEN)
            .filter(
                quest ->
                    QuestEngine.availability(state, quest, context)
                        == QuestEngine.Availability.OFFERABLE)
            .map(quest -> new Candidate(quest, salience(quest), 1))
            .toList();
    long seed =
        mix(state.player().getMostSignificantBits() ^ state.player().getLeastSignificantBits())
            ^ mix(npc.hashCode())
            ^ mix(context.calendar().day(context.now()).toEpochDay());
    return select(candidates, limit, seed);
  }

  /** Stable weighted sampling without replacement within each salience band. */
  public static List<Quest> select(List<Candidate> candidates, int limit, long seed) {
    if (limit < 0) {
      throw new IllegalArgumentException("storylet limit must not be negative");
    }
    var ranked = new ArrayList<>(candidates);
    ranked.sort(
        comparingInt(Candidate::salience)
            .reversed()
            .thenComparingDouble(candidate -> draw(seed, candidate))
            .thenComparing(candidate -> candidate.quest().id()));
    return ranked.stream().limit(limit).map(Candidate::quest).toList();
  }

  private static int salience(Quest quest) {
    return switch (quest.category()) {
      case STORY -> 4;
      case TRACK -> 3;
      case SIDE -> 2;
      case DAILY, WEEKLY -> 1;
      case HIDDEN -> 0;
    };
  }

  private static double draw(long seed, Candidate candidate) {
    long hash = mix(seed ^ idHash(candidate.quest().id()));
    double uniform = ((hash >>> 11) + 1.0) * 0x1.0p-53;
    return -Math.log(uniform) / candidate.weight();
  }

  /** Fold every character into 64 bits so valid IDs with equal String.hashCode still rotate. */
  private static long idHash(String id) {
    long hash = 0xCBF29CE484222325L;
    for (var index = 0; index < id.length(); index++) {
      hash ^= id.charAt(index);
      hash *= 0x100000001B3L;
    }
    return hash;
  }

  private static long mix(long value) {
    var mixed = (value ^ (value >>> 30)) * 0xBF58476D1CE4E5B9L;
    mixed = (mixed ^ (mixed >>> 27)) * 0x94D049BB133111EBL;
    return mixed ^ (mixed >>> 31);
  }
}
