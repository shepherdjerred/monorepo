package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Conversations;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.DialogueScreens;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Choice;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.trainer.Offer;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;

/**
 * Conversations with NPCs: what an NPC says when clicked, and what each button does. Every button
 * press is honored once (see {@link Conversations}). Main thread.
 */
public final class NpcTalk {

  static final String LABEL = "NPCs";

  /**
   * What talking needs.
   *
   * @param continueLabel the label of a {@code next} node's button
   */
  public record Wiring(
      NpcCatalog catalog,
      DialogueRegistry dialogues,
      ActionRegistry actions,
      DialogPresenter presenter,
      String continueLabel,
      ComponentLogger logger) {}

  private final Wiring wiring;
  private final Trainer trainer;
  private final Conversations conversations = new Conversations();

  public NpcTalk(Wiring wiring, Trainer trainer) {
    this.wiring = wiring;
    this.trainer = trainer;
  }

  /**
   * {@code player} clicked {@code npc}: show the first dialogue a provider offers, else the NPC's
   * own, else its trainer screen. An NPC with none of these says nothing.
   */
  public void talk(Player player, NpcDefinition npc) {
    var dialogue =
        wiring
            .dialogues()
            .provided(player, NpcRef.of(npc))
            .or(() -> wiring.catalog().content().dialogue(npc));
    if (dialogue.isPresent()) {
      var graph = dialogue.get();
      show(player, npc, DialogueScreens.node(graph, graph.start(), wiring.continueLabel()));
    } else if (npc.trainer().isPresent()) {
      openTrainer(player, npc, "");
    }
  }

  /** A button press from the dialog with {@code token}. */
  public void click(Player player, long token, int button) {
    var clicked = conversations.click(player.getUniqueId(), token, button);
    if (clicked.isEmpty()) {
      return;
    }
    var npc = wiring.catalog().content().npc(clicked.get().npc());
    if (npc.isEmpty()) {
      // The NPC was removed by a reload while the dialog was open.
      wiring.presenter().close(player);
      return;
    }
    choose(player, npc.get(), clicked.get().choice());
  }

  /** Forgets {@code player}'s conversation (they quit). */
  public void forget(Player player) {
    conversations.forget(player.getUniqueId());
  }

  private void choose(Player player, NpcDefinition npc, Choice choice) {
    switch (choice) {
      case Choice.Close() -> wiring.presenter().close(player);
      case Choice.ShowNode(var graph, var node) ->
          show(player, npc, DialogueScreens.node(graph, node, wiring.continueLabel()));
      case Choice.OpenTrainer() -> openTrainer(player, npc, "");
      case Choice.RunAction(var action) -> run(player, npc, action);
      case Choice.Buy(var offer) -> show(player, npc, trainer.confirm(npc, offer));
      case Choice.Confirm(var offer) -> buy(player, npc, offer);
    }
  }

  private void openTrainer(Player player, NpcDefinition npc, String note) {
    if (npc.trainer().isEmpty()) {
      // Only a provider's dialogue can get here: content dialogues are checked at load.
      wiring
          .logger()
          .error("A dialogue opened a trainer on NPC {}, which trains no track", npc.id());
      wiring.presenter().close(player);
      return;
    }
    whenOnline(player, npc, trainer.offer(player, npc, note));
  }

  private void buy(Player player, NpcDefinition npc, Offer offer) {
    wiring.presenter().close(player);
    whenOnline(
        player,
        npc,
        trainer.buy(player, npc, offer).thenCompose(note -> trainer.offer(player, npc, note)));
  }

  private void whenOnline(Player player, NpcDefinition npc, CompletableFuture<Screen> screen) {
    var _ =
        screen.whenComplete(
            (shown, failure) -> {
              if (failure != null) {
                wiring
                    .logger()
                    .error("Trainer {} failed for {}", npc.id(), player.getName(), failure);
                player.sendMessage(
                    HouseStyle.error(LABEL, Component.text("Training is unavailable right now.")));
              } else if (player.isOnline()) {
                show(player, npc, shown);
              }
            });
  }

  private void run(Player player, NpcDefinition npc, String id) {
    wiring.presenter().close(player);
    var action = wiring.actions().find(id);
    if (action.isEmpty()) {
      wiring.logger().error("NPC {} offered action {}, which no module registered", npc.id(), id);
      player.sendMessage(
          HouseStyle.error(LABEL, Component.text("That isn't available right now.")));
      return;
    }
    action.get().run(player, NpcRef.of(npc));
  }

  private void show(Player player, NpcDefinition npc, Screen screen) {
    var token = conversations.show(player.getUniqueId(), npc.id(), screen);
    wiring.presenter().show(player, screen, button -> click(player, token, button));
  }
}
