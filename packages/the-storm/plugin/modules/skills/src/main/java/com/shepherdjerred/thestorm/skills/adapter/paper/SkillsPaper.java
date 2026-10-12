package com.shepherdjerred.thestorm.skills.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.skills.app.SkillLevelUp;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.function.Consumer;

/** Installs the event progression and the two player-facing commands. */
public final class SkillsPaper {
  private SkillsPaper() {}

  /**
   * Registers the listener and commands.
   *
   * @param levelUps told of every saved level up, on the main thread
   */
  public static void install(
      ModuleContext context,
      SkillLevels levels,
      SkillsConfig config,
      Consumer<SkillLevelUp> levelUps) {
    var listener =
        new SkillListener(
            context,
            levels,
            config,
            new SkillListener.Hooks(context.services().require(SealedWorlds.class), levelUps));
    context.plugin().getServer().getPluginManager().registerEvents(listener, context.plugin());
    var commands = new SkillsCommands(context, levels, config);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
