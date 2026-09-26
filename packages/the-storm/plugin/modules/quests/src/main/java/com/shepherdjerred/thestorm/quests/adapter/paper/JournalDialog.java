package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.domain.view.Dialogues;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * The quest journal as a dialog: a plain-text body and a column of Track buttons (at most five, so
 * Bedrock's simple form shows it), then Close. Runtime dialogs are not in MockBukkit; the real-
 * server suite covers this.
 */
final class JournalDialog {

  static final int MAX_TRACK_BUTTONS = 5;
  private static final Duration LIFETIME = Duration.ofMinutes(10);

  private final Server server;
  private final Scheduler scheduler;
  private final QuestService service;

  JournalDialog(Server server, Scheduler scheduler, QuestService service) {
    this.server = server;
    this.scheduler = scheduler;
    this.service = service;
  }

  void show(Player player, Journal.View view) {
    var buttons = new ArrayList<ActionButton>();
    var catalog = service.catalog(player.getUniqueId());
    for (var quest : view.active().stream().limit(MAX_TRACK_BUTTONS).toList()) {
      var label = Dialogues.clip("Track " + Journal.name(catalog, quest), 32);
      buttons.add(
          ActionButton.builder(Component.text(label))
              .action(
                  DialogAction.customClick(
                      (response, audience) ->
                          onMainThread(() -> service.track(player.getUniqueId(), quest)),
                      ClickCallback.Options.builder().uses(1).lifetime(LIFETIME).build()))
              .build());
    }
    buttons.add(ActionButton.builder(Component.text("Close")).build());
    var base =
        DialogBase.builder(Component.text("Quest Journal"))
            .canCloseWithEscape(true)
            .afterAction(DialogBase.DialogAfterAction.CLOSE)
            .body(List.of(DialogBody.plainMessage(Component.text(view.body()))))
            .build();
    player.showDialog(
        Dialog.create(
            factory ->
                factory
                    .empty()
                    .base(base)
                    .type(DialogType.multiAction(buttons).columns(1).build())));
  }

  private void onMainThread(Runnable task) {
    if (server.isPrimaryThread()) {
      task.run();
    } else {
      scheduler.runOnMainThread(task);
    }
  }
}
