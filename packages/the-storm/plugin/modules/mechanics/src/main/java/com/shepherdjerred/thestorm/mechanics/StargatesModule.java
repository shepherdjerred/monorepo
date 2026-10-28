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
    var base = System.getenv("FLIPT_URL");
    var environment = System.getenv("FLIPT_ENVIRONMENT");
    FliptStargatesGate gate = null;
    if (base != null && !base.isBlank() && environment != null && !environment.isBlank()) {
      gate = new FliptStargatesGate(URI.create(base), environment);
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
