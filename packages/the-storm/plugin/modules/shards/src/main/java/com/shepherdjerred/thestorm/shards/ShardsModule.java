package com.shepherdjerred.thestorm.shards;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.shards.adapter.paper.PaperShards;
import com.shepherdjerred.thestorm.shards.app.ShardUpgrades;
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
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .stateless(id());
    var config = context.loadConfig("shards.yml", ShardsConfig.class);
    var upgrades = new ShardUpgrades();
    context.services().provide(ShardUpgrades.class, upgrades);
    context.services().provide(StormShards.class, PaperShards.install(context, config, upgrades));
  }
}
