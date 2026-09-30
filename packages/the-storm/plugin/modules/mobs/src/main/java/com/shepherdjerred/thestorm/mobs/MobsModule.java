package com.shepherdjerred.thestorm.mobs;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mobs.adapter.paper.MobsPaper;
import com.shepherdjerred.thestorm.mobs.app.MobLevels;
import com.shepherdjerred.thestorm.mobs.domain.config.MobsConfig;
import org.jspecify.annotations.Nullable;

/**
 * Levelled hostile mobs, The Storm's replacement for LevelledMobs: the further from the world spawn
 * (and the deeper, and the fuller the moon) a monster spawns, the higher its level, and the tougher
 * it is and the more it drops. Publishes {@link MobLevels}. Needs land protection from the towns
 * module only when {@code mobs.yml} lists admin regions.
 */
public final class MobsModule implements StormModule {

  private @Nullable MobsPaper paper;

  @Override
  public String id() {
    return "mobs";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("mobs.yml", MobsConfig.class);
    var started =
        MobsPaper.start(context, config, () -> context.services().require(Protection.class));
    paper = started;
    context.services().provide(MobLevels.class, started.levels());
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
  }
}
