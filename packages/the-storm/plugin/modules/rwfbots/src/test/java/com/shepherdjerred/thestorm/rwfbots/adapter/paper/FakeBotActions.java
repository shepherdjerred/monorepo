package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** Records every rule action a driver asks for; refuses what a test says to refuse. */
public final class FakeBotActions implements BotActions {

  private final List<String> calls = new ArrayList<>();
  private Optional<ActionRefusal> refuseWith = Optional.empty();

  public void refuseWith(Optional<ActionRefusal> refusal) {
    refuseWith = refusal;
  }

  public List<String> calls() {
    var copy = List.copyOf(calls);
    calls.clear();
    return copy;
  }

  private Optional<ActionRefusal> record(String call) {
    calls.add(call);
    return refuseWith;
  }

  @Override
  public Optional<ActionRefusal> clickBomb(UUID bot, String bombId) {
    return record("bomb " + bombId);
  }

  @Override
  public Optional<ActionRefusal> useRewind(UUID bot) {
    return record("rewind");
  }

  @Override
  public Optional<ActionRefusal> melee(UUID attacker, UUID target) {
    return record("melee " + target);
  }

  @Override
  public Optional<ActionRefusal> shootBow(UUID bot, Point direction, double force) {
    return record(
        String.format(
            Locale.ROOT,
            "shoot %.2f,%.2f,%.2f force %.3f",
            direction.x() + 0.0,
            direction.y() + 0.0,
            direction.z() + 0.0,
            force));
  }

  @Override
  public Optional<ActionRefusal> consume(UUID bot, int slot) {
    return record("consume " + slot);
  }

  @Override
  public Optional<ActionRefusal> pickKit(UUID bot, String kitId) {
    return record("kit " + kitId);
  }
}
