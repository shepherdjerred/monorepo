package com.shepherdjerred.thestorm.skills.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;

/** Installs the event progression and the two player-facing commands. */
public final class SkillsPaper {
  private SkillsPaper() {}

  public static void install(ModuleContext context, SkillLevels levels, SkillsConfig config) {
    var listener = new SkillListener(context, levels, config);
    context.plugin().getServer().getPluginManager().registerEvents(listener, context.plugin());
    var commands = new SkillsCommands(context, levels, config);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
