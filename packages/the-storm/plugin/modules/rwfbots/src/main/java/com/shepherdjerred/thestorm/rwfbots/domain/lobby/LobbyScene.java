package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The lobby at one tick, as the bots in it see it: everyone standing in it.
 *
 * @param tick the server tick it was captured on
 * @param people everyone in the lobby, humans and bots
 */
public record LobbyScene(long tick, List<Person> people) {

  public LobbyScene {
    people = List.copyOf(people);
    var seen = new HashSet<UUID>();
    for (var person : people) {
      if (!seen.add(person.uuid())) {
        throw new IllegalArgumentException("person listed twice: " + person.uuid());
      }
    }
  }

  /**
   * Someone in the lobby.
   *
   * @param uuid their entity
   * @param personality the personality driving a bot; empty for a human
   * @param feet where their feet are
   */
  public record Person(UUID uuid, Optional<String> personality, Vec3 feet) {

    public boolean human() {
      return personality.isEmpty();
    }
  }

  public Optional<Person> person(UUID uuid) {
    return people.stream().filter(person -> person.uuid().equals(uuid)).findFirst();
  }
}
