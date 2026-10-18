package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.entity.Player;

/** The first-arrival picker, also reopened by the newcomer's compass. */
final class ArrivalDialog {
  private final Dialog dialog;

  ArrivalDialog(ModuleContext context, QolConfig config, RtpFlow flow) {
    var world = context.services().require(WildWorlds.class).defaultWorld().name();
    var options =
        ClickCallback.Options.builder()
            .uses(ClickCallback.UNLIMITED_USES)
            .lifetime(Duration.ofDays(3650))
            .build();
    var buttons = new ArrayList<ActionButton>();
    for (var biome : config.biomes()) {
      buttons.add(
          ActionButton.create(
              Component.text(label(biome)),
              Component.text("Find a safe spot in " + label(biome)),
              150,
              DialogAction.customClick(
                  (view, audience) -> {
                    if (audience instanceof Player player) {
                      player.closeDialog();
                      flow.start(player, world, Optional.of(biome));
                    }
                  },
                  options)));
    }
    dialog =
        Dialog.create(
            factory ->
                factory
                    .empty()
                    .base(
                        DialogBase.builder(Component.text("Welcome to The Storm!"))
                            .canCloseWithEscape(true)
                            .pause(false)
                            .body(
                                List.of(
                                    DialogBody.plainMessage(
                                        Component.text(
                                            "Choose a biome to start building, or explore spawn first. Left- or right-click your compass whenever you're ready to leave."))))
                            .build())
                    .type(
                        DialogType.multiAction(buttons)
                            .columns(2)
                            .exitAction(
                                ActionButton.builder(Component.text("Explore Spawn")).build())
                            .build()));
  }

  void show(Player player) {
    player.showDialog(dialog);
  }

  static String label(String biome) {
    return java.util.Arrays.stream(biome.split("_"))
        .map(word -> word.substring(0, 1).toUpperCase(Locale.ROOT) + word.substring(1))
        .collect(java.util.stream.Collectors.joining(" "));
  }
}
