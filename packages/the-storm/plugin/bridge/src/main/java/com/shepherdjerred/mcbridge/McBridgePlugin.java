package com.shepherdjerred.mcbridge;

import com.shepherdjerred.mcbridge.adapter.http.BridgeHttpServer;
import com.shepherdjerred.mcbridge.adapter.paper.EventCapture;
import com.shepherdjerred.mcbridge.adapter.paper.LogCapture;
import com.shepherdjerred.mcbridge.adapter.paper.PaperMainThread;
import com.shepherdjerred.mcbridge.adapter.paper.RegionReader;
import com.shepherdjerred.mcbridge.adapter.paper.ServerService;
import com.shepherdjerred.mcbridge.adapter.worldedit.AgentSessions;
import com.shepherdjerred.mcbridge.adapter.worldedit.SnapshotStore;
import com.shepherdjerred.mcbridge.adapter.worldedit.WorldEditService;
import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.BridgeConfig;
import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.Limits;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.SecureRandom;
import java.time.InstantSource;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/** Starts the HTTP bridge once WorldEdit is enabled, and stops it with the server. */
public final class McBridgePlugin extends JavaPlugin {
  private @Nullable BridgeHttpServer http;
  private @Nullable LogCapture logCapture;
  private @Nullable AgentSessions sessions;

  @Override
  public void onEnable() {
    BridgeConfig config;
    try {
      config = BridgeConfig.fromEnv(System.getenv());
    } catch (IllegalStateException e) {
      getLogger().severe(e.getMessage());
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    InstantSource time = InstantSource.system();
    EventRing ring = new EventRing(Limits.EVENT_CAPACITY, time);
    MainThread mainThread = new PaperMainThread(this);
    ServerService server = new ServerService(getServer(), mainThread, ring);
    AgentSessions agentSessions = new AgentSessions();
    agentSessions.register();
    sessions = agentSessions;
    WorldEditService worldEdit = new WorldEditService(agentSessions, server, mainThread, ring);
    SnapshotStore snapshots =
        new SnapshotStore(
            getDataFolder().toPath().resolve("snapshots"),
            new SnapshotStore.Dependencies(
                server, worldEdit, mainThread, time, new SecureRandom()));
    BridgeRoutes routes =
        new BridgeRoutes(
            getPluginMeta().getVersion(),
            new BridgeRoutes.Services(
                server, new RegionReader(server, mainThread), worldEdit, snapshots, ring));
    getServer().getPluginManager().registerEvents(new EventCapture(ring), this);
    logCapture = LogCapture.attach(ring);
    try {
      http = BridgeHttpServer.start(config, routes.router(), getLogger());
    } catch (IOException e) {
      throw new UncheckedIOException(
          "MCBridge could not bind " + config.bind() + ":" + config.port(), e);
    }
    getLogger().info("MCBridge listening on " + config.bind() + ":" + http.port());
  }

  @Override
  public void onDisable() {
    if (http != null) {
      http.stop();
      http = null;
    }
    if (logCapture != null) {
      logCapture.detach();
      logCapture = null;
    }
    if (sessions != null) {
      sessions.unregister();
      sessions = null;
    }
  }
}
