package com.shepherdjerred.thestorm.reset.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.reset.app.PlayerResetService;
import com.shepherdjerred.thestorm.reset.app.ResetStore;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import org.jspecify.annotations.Nullable;

/** Paper registrations for the reset module. */
public final class ResetPaper {

  private @Nullable ResetCommands commands;

  private ResetPaper() {}

  public static ResetPaper start(
      ModuleContext context, ResetStore store, PlayerResetService resets) {
    var paper = new ResetPaper();
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(new ResetLoginGate(store, context), context.plugin());
    var commands = new ResetCommands(context, resets);
    paper.commands = commands;
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    return paper;
  }

  public void stop() {
    if (commands != null) {
      commands.stop();
      commands = null;
    }
  }
}
