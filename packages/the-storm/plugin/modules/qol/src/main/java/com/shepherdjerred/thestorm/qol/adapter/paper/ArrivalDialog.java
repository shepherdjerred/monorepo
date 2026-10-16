package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.mobs.app.BeginnerStatus;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
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

  private final ModuleContext context;
  private final java.util.function.Function<String, Dialog> render;
  private final String world;

  ArrivalDialog(ModuleContext context, QolConfig config, RtpFlow flow) {
    this.context = context;
    var worlds = context.services().require(WildWorlds.class);
    var rules = context.services().require(TeleportTravel.class).policy();
    this.world = worlds.defaultWorld().name();
    this.render = explanation -> create(config, flow, rules, explanation);
  }

  private Dialog create(
      QolConfig config, RtpFlow flow, TeleportTravel.Policy rules, String explanation) {
    var options =
        ClickCallback.Options.builder()
            .uses(ClickCallback.UNLIMITED_USES)
            .lifetime(Duration.ofDays(3650))
            .build();
    var buttons = new ArrayList<ActionButton>();
    for (var biome : config.biomes()) {
      buttons.add(button(biome, options, flow));
    }
    var body = new ArrayList<DialogBody>();
    body.add(
        DialogBody.plainMessage(
            Component.text(
                "Welcome to The Storm! Your starter tools and food are ready. Pick a biome, gather resources, and build your first shelter. Use /sethome there so you can return with /home. You can also close this and explore spawn.")));
    if (!explanation.isEmpty()) body.add(DialogBody.plainMessage(Component.text(explanation)));
    body.add(
        DialogBody.plainMessage(
            Component.text(
                "Random teleport is free for your first "
                    + DurationText.of(rules.rtpFreeFor())
                    + ". Other travel and death recovery use normal prices and cooldowns. /tpinfo explains travel; /graves lists your graves.")));
    return Dialog.create(
        factory ->
            factory
                .empty()
                .base(
                    DialogBase.builder(Component.text("Pick a place to start"))
                        .canCloseWithEscape(true)
                        .pause(false)
                        .body(body)
                        .build())
                .type(DialogType.multiAction(buttons).columns(2).build()));
  }

  void show(Player player) {
    var beginner = context.services().find(BeginnerStatus.class);
    if (beginner.isEmpty()) {
      player.showDialog(render.apply(""));
      return;
    }
    var _ =
        beginner
            .orElseThrow()
            .status(player.getUniqueId())
            .whenCompleteAsync(
                (status, failure) -> {
                  if (!player.isOnline()) return;
                  if (failure != null) {
                    context.logger().error("Could not load first-arrival protection", failure);
                    player.sendMessage(
                        "Your welcome is still loading. You can explore spawn and use /beginnersluck to check your protection.");
                    return;
                  }
                  var explanation =
                      status.enabled()
                          ? "Beginner's luck makes nearby mobs much weaker for your first "
                              + DurationText.of(status.calmFor())
                              + " of active play, then gradually raises difficulty to normal by "
                              + DurationText.of(status.normalAfter())
                              + ". Mobs still attack, and death still leaves a grave. Offline and AFK time pause the clock. Check /beginnersluck anytime."
                          : "";
                  player.showDialog(render.apply(explanation));
                },
                context.scheduler().mainThread());
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
