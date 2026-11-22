package com.shepherdjerred.thestorm.mechanics;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.mechanics.adapter.paper.StargatesPaper;
import com.shepherdjerred.thestorm.mechanics.adapter.remote.FliptStargatesGate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateConfig;
import java.net.URI;
import org.jspecify.annotations.Nullable;

/** Player-built Stargates, installed after tracks, towns, creative and essentials. */
public final class StargatesModule implements StormModule {
  private @Nullable StargatesPaper paper;

  @Override
  public String id() {
    return "stargates";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("stargates.yml", StargateConfig.class);
    context.database().migrate("mechanics", getClass().getClassLoader());
    var base = System.getenv("FLAGS_URL");
    var deployment = System.getenv("FLAGS_DEPLOYMENT");
    FliptStargatesGate gate = null;
    if (base != null && !base.isBlank() && deployment != null && !deployment.isBlank()) {
      gate = new FliptStargatesGate(URI.create(base), deployment);
    }
    paper = StargatesPaper.start(context, config, gate);
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
  }
}
