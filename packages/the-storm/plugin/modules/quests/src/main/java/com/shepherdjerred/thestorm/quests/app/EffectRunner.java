package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.Effect;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.view.Names;
import java.util.UUID;

/** Carries out one player's quest effects: messages, items, crystals, grants and world actions. */
final class EffectRunner {

  private final UUID player;
  private final QuestService.Wiring wiring;
  private final Notices notices;
  private final QuestService service;

  EffectRunner(UUID player, QuestService.Wiring wiring, Notices notices, QuestService service) {
    this.player = player;
    this.wiring = wiring;
    this.notices = notices;
    this.service = service;
  }

  void run(Effect effect, Catalog catalog) {
    notices.chat(effect, catalog).ifPresent(message -> wiring.world().send(player, message));
    notices.actionBar(effect, catalog).ifPresent(line -> wiring.world().actionBar(player, line));
    if (effect instanceof Effect.World(var quest, var action)) {
      world(quest, action);
    }
  }

  private void world(String quest, Action action) {
    var world = wiring.world();
    switch (action) {
      case Action.Give(var item, var amount) -> world.give(player, item, amount);
      case Action.Take(var item, var amount) -> world.take(player, item, amount);
      case Action.Crystals(var amount) -> pay(quest, amount);
      case Action.Grant(var node) -> grant(node, "");
      case Action.Title(var id) ->
          grant(PermissionGrants.title(id), "You earned the title " + Names.pretty(id) + ".");
      case Action.Spell(var id) ->
          grant(PermissionGrants.spell(id), "You learned the " + Names.pretty(id) + " spell.");
      case Action.Message(var text) -> world.send(player, Notices.info(text));
      case Action.Teleport(var region) ->
          wiring.content().region(region).ifPresent(found -> world.teleport(player, found));
      case Action.Spawn spawn ->
          wiring
              .content()
              .region(spawn.region())
              .ifPresent(found -> world.spawn(player, spawn, found));
      case Action.Custom(var hook, var argument) -> custom(quest, hook, argument);
      case Action.SetVariable _,
          Action.AddVariable _,
          Action.Reputation _,
          Action.Points _,
          Action.StartQuest _,
          Action.Marker _ -> {
        // State actions are applied by the engine and never reach the world.
      }
    }
  }

  private void pay(String quest, long amount) {
    var _ =
        wiring
            .rewards()
            .pay(player, amount, "quest:" + quest)
            .whenCompleteAsync(
                (result, failure) -> {
                  if (failure != null) {
                    wiring.logger().error("Paying {} for quest {} failed", player, quest, failure);
                    wiring
                        .world()
                        .send(player, Notices.error("Your crystal reward could not be paid."));
                    return;
                  }
                  switch (result) {
                    case Result.Ok<String, String>(var words) ->
                        wiring.world().send(player, Notices.success("+" + words));
                    case Result.Err<String, String>(var why) -> {
                      wiring.logger().error("Quest {} reward for {}: {}", quest, player, why);
                      wiring
                          .world()
                          .send(player, Notices.error("Your crystal reward could not be paid."));
                    }
                  }
                },
                wiring.mainThread());
  }

  private void grant(String permission, String message) {
    var _ =
        wiring
            .rewards()
            .grant(player, permission)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    wiring.logger().error("Granting {} to {} failed", permission, player, failure);
                  } else if (!message.isEmpty()) {
                    wiring.world().send(player, Notices.success(message));
                  }
                },
                wiring.mainThread());
  }

  private void custom(String quest, String hook, String argument) {
    var action = service.customAction(hook);
    var online = wiring.world().player(player);
    if (action.isEmpty()) {
      wiring
          .logger()
          .error("Quest {} ran custom action {}, which no module registered", quest, hook);
      return;
    }
    online.ifPresent(found -> action.get().run(found, argument));
  }
}
