package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ActionTicket;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatCommands;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Independent action clock and acknowledgements for one disposable duel body. */
final class DuelActor {
  private Optional<CombatHarness.Frame> latest = Optional.empty();
  private Optional<ActionTicket> action = Optional.empty();
  private final ArrayDeque<CombatHarness.Frame> contexts = new ArrayDeque<>();
  private final ArrayDeque<Long> used = new ArrayDeque<>();
  private long acceptedTick = -1;
  private long applied;
  private long fallback;

  Optional<CombatHarness.Frame> latest() {
    return latest;
  }

  void clearAction() {
    action = Optional.empty();
  }

  List<BodyCommand> commands(CombatHarness.Frame frame, boolean external) {
    latest = Optional.of(frame);
    contexts.addLast(frame);
    while (contexts.size() > 3) contexts.removeFirst();
    if (!external) return frame.authored().commands();
    var response =
        action.filter(
            ticket ->
                ticket.applies(
                    frame.matchId(), frame.body(), frame.life(), frame.input().snapshot().tick()));
    if (response.isEmpty()
        || !CombatCommands.eligible(frame.authored().commands(), frame.input())) {
      fallback++;
      return frame.authored().commands();
    }
    applied++;
    var usedTick = response.orElseThrow().tick();
    if (!used.contains(usedTick)) used.addLast(usedTick);
    while (used.size() > 4) used.removeFirst();
    return CombatCommands.replace(
        frame.authored().commands(), frame.input(), response.orElseThrow());
  }

  CombatHarness.Frame context(long tick) {
    return contexts.stream()
        .filter(frame -> frame.input().snapshot().tick() == tick)
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("observation context expired"));
  }

  void validate(ActionTicket ticket) {
    var current = latest.orElseThrow();
    if (ticket.tick() <= acceptedTick
        || !ticket.applies(
            current.matchId(), current.body(), current.life(), current.input().snapshot().tick()))
      throw new IllegalArgumentException("stale, duplicate or wrong-context action");
  }

  void accept(ActionTicket ticket) {
    acceptedTick = ticket.tick();
    action = Optional.of(ticket);
  }

  Map<String, Object> fields(boolean live) {
    var fields = new LinkedHashMap<String, Object>();
    fields.put("used", List.copyOf(used));
    fields.put("applied", applied);
    fields.put("fallback", fallback);
    latest.ifPresent(
        frame -> {
          fields.put("body", frame.body().toString());
          fields.put("life", frame.life());
          fields.put("tick", frame.input().snapshot().tick());
          if (live)
            frame.observation().ifPresent(sample -> fields.put("observation", sample.values()));
        });
    return fields;
  }
}
