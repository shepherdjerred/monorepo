package dev.tsmc.skylands;

import com.shepherdjerred.thestorm.skylands.adapter.resource.NativeSkyAssetSource;
import com.shepherdjerred.thestorm.skylands.app.SkylandsAssets;
import io.papermc.paper.plugin.bootstrap.BootstrapContext;
import io.papermc.paper.plugin.bootstrap.PluginBootstrap;
import io.papermc.paper.plugin.bootstrap.PluginProviderContext;
import java.util.Objects;

/** Exercises the same early resource preparation as TheStormBootstrap. */
public final class ProceduralSkylandsBootstrap implements PluginBootstrap {
  private SkylandsAssets assets;
  private String preparationThread;

  @Override public void bootstrap(BootstrapContext context) {
    preparationThread = Thread.currentThread().getName();
    assets = NativeSkyAssetSource.read();
    System.out.println("LAYERED_ASSETS_READY thread=" + preparationThread + " templates=" + assets.keys().size());
  }

  @Override public ProceduralSkylandsFixture createPlugin(PluginProviderContext context) {
    return new ProceduralSkylandsFixture(Objects.requireNonNull(assets), Objects.requireNonNull(preparationThread));
  }
}
