package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Optional;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.entity.Player;

/** Biome buttons shown the first time qol sees a player. */
final class ArrivalDialog {

  private final Dialog dialog;
  private final String world;

  ArrivalDialog(QolConfig config, WildWorlds worlds, RtpFlow flow) {
    this.world = worlds.defaultWorld().name();
    var options =
        ClickCallback.Options.builder()
            .uses(ClickCallback.UNLIMITED_USES)
            .lifetime(Duration.ofDays(3650))
            .build();
    var buttons = new ArrayList<ActionButton>();
    for (var biome : config.biomes()) {
      buttons.add(button(biome, options, flow));
    }
    this.dialog =
        Dialog.create(
            factory ->
                factory
                    .empty()
                    .base(
                        DialogBase.builder(Component.text("Pick a place to start"))
                            .canCloseWithEscape(true)
                            .pause(false)
                            .build())
                    .type(DialogType.multiAction(buttons).columns(2).build()));
  }

  void show(Player player) {
    player.showDialog(dialog);
  }

  private ActionButton button(String biome, ClickCallback.Options options, RtpFlow flow) {
    return ActionButton.create(
        Component.text(label(biome)),
        Component.text("Land in a " + label(biome) + " in " + world),
        150,
        DialogAction.customClick((view, audience) -> start(flow, audience, biome), options));
  }

  private void start(RtpFlow flow, Audience audience, String biome) {
    if (audience instanceof Player player) {
      flow.start(player, world, Optional.of(biome));
    }
  }

  private static String label(String biome) {
    return biome.replace('_', ' ');
  }
}
