package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.chat.domain.ChatText;
import com.shepherdjerred.thestorm.chat.domain.FilterSettings;
import com.shepherdjerred.thestorm.chat.domain.Shouting;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Placeholder;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Expected authored greetings through the same placeholder and chat-text transforms as delivery.
 */
public final class GreetingExpectations {
  private GreetingExpectations() {}

  public static List<String> rendered(
      List<String> pool, Optional<String> team, FilterSettings filter) {
    var values = team.map(name -> Map.of(Placeholder.TEAM, name)).orElseGet(Map::of);
    return pool.stream()
        .filter(line -> values.keySet().containsAll(Lines.placeholdersOf(line)))
        .map(line -> ChatDirector.fill(line, values))
        .map(ChatText::clean)
        .map(line -> Shouting.calm(line, filter.maxCapsWords()))
        .toList();
  }
}
