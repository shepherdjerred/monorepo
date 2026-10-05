package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The match as chat sees it after a transition: everyone in it, in match order.
 *
 * @param members every combatant still in the match
 */
public record ChatScene(List<Member> members) {

  public ChatScene {
    members = List.copyOf(members);
    var seen = new HashSet<UUID>();
    for (var member : members) {
      if (!seen.add(member.uuid())) {
        throw new IllegalArgumentException("member listed twice: " + member.uuid());
      }
    }
  }

  /**
   * One combatant.
   *
   * @param uuid the combatant
   * @param name their name as players see it in game
   * @param bot the personality driving them; empty for a human
   * @param team their team's display name, such as {@code Red Team}, once the match has started
   * @param alive whether they are still fighting
   */
  public record Member(
      UUID uuid, String name, Optional<Personality> bot, Optional<String> team, boolean alive) {

    public Member {
      if (name.isBlank()) {
        throw new IllegalArgumentException("member name must not be blank");
      }
    }

    /** The personality id, for a bot. */
    public Optional<String> personalityId() {
      return bot.map(Personality::id);
    }
  }

  public Optional<Member> member(UUID uuid) {
    return members.stream().filter(member -> member.uuid().equals(uuid)).findFirst();
  }

  /** Every team that has members, in first-seen order. */
  public List<String> teams() {
    return members.stream().flatMap(member -> member.team().stream()).distinct().toList();
  }

  /** The living members of {@code team}. */
  public List<Member> alive(String team) {
    return members.stream()
        .filter(member -> member.alive() && member.team().filter(team::equals).isPresent())
        .toList();
  }
}
