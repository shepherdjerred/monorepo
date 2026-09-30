package com.shepherdjerred.thestorm.messages;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.messages.adapter.paper.Announcer;
import com.shepherdjerred.thestorm.messages.adapter.paper.CommandBlocklistListener;
import com.shepherdjerred.thestorm.messages.adapter.paper.DeathMessageListener;
import com.shepherdjerred.thestorm.messages.adapter.paper.MiniText;
import com.shepherdjerred.thestorm.messages.adapter.paper.MotdListener;
import com.shepherdjerred.thestorm.messages.adapter.paper.PreferenceStore;
import com.shepherdjerred.thestorm.messages.adapter.paper.RegistryChecks;
import com.shepherdjerred.thestorm.messages.adapter.paper.TabListListener;
import com.shepherdjerred.thestorm.messages.adapter.paper.ToggleCommands;
import com.shepherdjerred.thestorm.messages.config.MessagesConfig;
import com.shepherdjerred.thestorm.messages.domain.Channel;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.event.Listener;

/**
 * The Storm's voice: joke death messages with death-spam hiding, the rotating server-list MOTD,
 * tips and ads, the tab list, and a blocklist for commands that reveal the server's plugins.
 * Successor to stServerMessages.
 */
public final class MessagesModule implements StormModule {

  private final List<Cancellable> announcers = new ArrayList<>();

  @Override
  public String id() {
    return "messages";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("messages.yml", MessagesConfig.class);
    RegistryChecks.requireEveryDamageTypeMapped();
    RegistryChecks.requireEntityTypes(
        config.deaths().mobs().groups().stream().flatMap(group -> group.types().stream()).toList());

    var deaths = config.deaths();
    var commands = config.commands();
    register(
        context,
        new DeathMessageListener(
            deaths.catalog(),
            Component.text(deaths.unarmed()),
            deaths.spam().limiter(),
            new DeathMessageListener.Sources(context.random(), context.time())),
        new MotdListener(
            config.motd().stream()
                .map(
                    motd ->
                        MiniText.parse(motd.top(), "motd top")
                            .append(Component.newline())
                            .append(MiniText.parse(motd.bottom(), "motd bottom")))
                .toList()),
        new TabListListener(
            MiniText.parse(config.tab().header(), "tab.header"),
            MiniText.parse(config.tab().footer(), "tab.footer")),
        new CommandBlocklistListener(
            commands.blocklist(),
            commands.staffBypassPermission(),
            MiniText.parse(commands.blockedMessage(), "commands.blockedMessage")));

    var preferences = new PreferenceStore(context.plugin());
    var audience =
        new Announcer.Audience(context.plugin().getServer(), preferences, context.random());
    schedule(
        context,
        config.announcements().tips(),
        new Announcer(
            Channel.TIPS,
            "Tips",
            MiniText.parseAll(config.announcements().tips().messages(), "announcements.tips"),
            audience));
    var ads = config.announcements().ads();
    if (!ads.messages().isEmpty()) {
      schedule(
          context,
          ads,
          new Announcer(
              Channel.ADS,
              "Ads",
              MiniText.parseAll(ads.messages(), "announcements.ads"),
              audience));
    }

    var announced = ads.messages().isEmpty() ? Set.of(Channel.TIPS) : Set.of(Channel.values());
    var toggles = new ToggleCommands(preferences, announced);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> toggles.register(event.registrar()));
  }

  @Override
  public void disable() {
    announcers.forEach(Cancellable::cancel);
    announcers.clear();
  }

  private void schedule(
      ModuleContext context, MessagesConfig.Announcer settings, Announcer announcer) {
    announcers.add(
        context
            .scheduler()
            .repeatOnMainThread(settings.interval(), settings.interval(), announcer));
  }

  private static void register(ModuleContext context, Listener... listeners) {
    var plugin = context.plugin();
    for (var listener : listeners) {
      plugin.getServer().getPluginManager().registerEvents(listener, plugin);
    }
  }
}
