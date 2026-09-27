package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.Effect;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.view.Names;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

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
  }

  CompletableFuture<Boolean> world(UUID effect, String quest, Action action) {
    var world = wiring.world();
    if (world.facts(player).isEmpty()) {
      return CompletableFuture.completedFuture(false);
    }
    return switch (action) {
      case Action.Give(var item, var amount) -> {
        world.give(player, item, amount);
        yield CompletableFuture.completedFuture(true);
      }
      case Action.Take(var item, var amount) ->
          CompletableFuture.completedFuture(world.take(player, item, amount));
      case Action.Crystals(var amount) -> pay(effect, quest, amount);
      case Action.Grant(var node) -> grant(node, "");
      case Action.Title(var id) ->
          grant(PermissionGrants.title(id), "You earned the title " + Names.pretty(id) + ".");
      case Action.Spell(var id) ->
          grant(PermissionGrants.spell(id), "You learned the " + Names.pretty(id) + " spell.");
      case Action.Message(var text) -> {
        world.send(player, Notices.info(text));
        yield CompletableFuture.completedFuture(true);
      }
      case Action.Teleport(var region) -> {
        yield world.teleport(
            player,
            wiring
                .content()
                .region(region)
                .orElseThrow(() -> new IllegalStateException("missing quest region: " + region)));
      }
      case Action.Spawn spawn -> {
        world.spawn(
            player,
            spawn,
            wiring
                .content()
                .region(spawn.region())
                .orElseThrow(
                    () -> new IllegalStateException("missing quest region: " + spawn.region())));
        yield CompletableFuture.completedFuture(true);
      }
      case Action.Custom(var hook, var argument) -> custom(quest, hook, argument);
      case Action.SetVariable _,
          Action.AddVariable _,
          Action.Reputation _,
          Action.Points _,
          Action.StartQuest _,
          Action.Marker _ ->
          throw new IllegalStateException("state action in world outbox: " + action);
    };
  }

  private CompletableFuture<Boolean> pay(UUID effect, String quest, long amount) {
    return wiring
        .rewards()
        .pay(effect, player, amount, "quest:" + quest)
        .handleAsync(
            (result, failure) -> {
              if (failure != null) {
                wiring.logger().error("Paying {} for quest {} failed", player, quest, failure);
                wiring
                    .world()
                    .send(player, Notices.error("Your crystal reward could not be paid."));
                return false;
              }
              return switch (result) {
                case Result.Ok<String, String>(var words) -> {
                  wiring.world().send(player, Notices.success("+" + words));
                  yield true;
                }
                case Result.Err<String, String>(var why) -> {
                  wiring.logger().error("Quest {} reward for {}: {}", quest, player, why);
                  wiring
                      .world()
                      .send(player, Notices.error("Your crystal reward could not be paid."));
                  yield false;
                }
              };
            },
            wiring.mainThread());
  }

  private CompletableFuture<Boolean> grant(String permission, String message) {
    return wiring
        .rewards()
        .grant(player, permission)
        .handleAsync(
            (ignored, failure) -> {
              if (failure != null) {
                wiring.logger().error("Granting {} to {} failed", permission, player, failure);
                return false;
              }
              if (!message.isEmpty()) {
                wiring.world().send(player, Notices.success(message));
              }
              return true;
            },
            wiring.mainThread());
  }

  private CompletableFuture<Boolean> custom(String quest, String hook, String argument) {
    var action = service.customAction(hook);
    var online = wiring.world().player(player);
    if (action.isEmpty()) {
      wiring
          .logger()
          .error("Quest {} ran custom action {}, which no module registered", quest, hook);
      return CompletableFuture.completedFuture(false);
    }
    if (online.isEmpty()) {
      return CompletableFuture.completedFuture(false);
    }
    action.get().run(online.get(), argument);
    return CompletableFuture.completedFuture(true);
  }
}
