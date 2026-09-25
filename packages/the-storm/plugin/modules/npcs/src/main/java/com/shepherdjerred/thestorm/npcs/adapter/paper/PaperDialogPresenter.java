package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.npcs.app.DialogPresenter;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntConsumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * Renders screens with the Dialog API: a title, one plain-message body and a single column of
 * buttons with no inputs. Geyser shows this to Bedrock players as a simple form. Each button runs a
 * one-use callback; clicks can still arrive twice, which {@code NpcTalk} ignores.
 */
final class PaperDialogPresenter implements DialogPresenter {

  private final Server server;
  private final Scheduler scheduler;
  private final Duration lifetime;

  PaperDialogPresenter(Server server, Scheduler scheduler, Duration lifetime) {
    this.server = server;
    this.scheduler = scheduler;
    this.lifetime = lifetime;
  }

  @Override
  public void show(Player player, Screen screen, IntConsumer onClick) {
    var buttons = new ArrayList<ActionButton>();
    for (var index = 0; index < screen.buttons().size(); index++) {
      var button = index;
      buttons.add(
          ActionButton.builder(Component.text(screen.buttons().get(index).label()))
              .action(
                  DialogAction.customClick(
                      (response, audience) -> onMainThread(() -> onClick.accept(button)),
                      ClickCallback.Options.builder().uses(1).lifetime(lifetime).build()))
              .build());
    }
    var base =
        DialogBase.builder(Component.text(screen.title()))
            .canCloseWithEscape(true)
            .afterAction(DialogBase.DialogAfterAction.CLOSE)
            .body(List.of(DialogBody.plainMessage(Component.text(screen.body()))))
            .build();
    player.showDialog(
        Dialog.create(
            factory ->
                factory
                    .empty()
                    .base(base)
                    .type(DialogType.multiAction(buttons).columns(1).build())));
  }

  @Override
  public void close(Player player) {
    player.closeDialog();
  }

  private void onMainThread(Runnable task) {
    if (server.isPrimaryThread()) {
      task.run();
    } else {
      scheduler.runOnMainThread(task);
    }
  }
}
