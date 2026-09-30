package com.shepherdjerred.thestorm.shards;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.shards.adapter.paper.PaperShards;
import com.shepherdjerred.thestorm.shards.app.StormShards;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;

/**
 * Storm Shards, The Storm's endgame: rare shards drop from ores and mobs, and the spawn windmill's
 * altar spends them in the rain to raise gear from Storm I to Storm V.
 */
public final class ShardsModule implements StormModule {

  @Override
  public String id() {
    return "shards";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("shards.yml", ShardsConfig.class);
    context.services().provide(StormShards.class, PaperShards.install(context, config));
  }
}
