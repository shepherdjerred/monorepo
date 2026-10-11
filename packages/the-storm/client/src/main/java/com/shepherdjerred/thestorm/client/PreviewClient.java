package com.shepherdjerred.thestorm.client;

import java.io.IOException;
import java.nio.file.Path;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

/** Only the dedicated launcher supplies the session bootstrap; ordinary clients remain inert. */
public final class PreviewClient implements ClientModInitializer {
  public PreviewClient() {}

  @Override
  public void onInitializeClient() {
    var file = System.getProperty("storm.client.session");
    if (file == null) return;
    var session = readSession(file);
    var actions = new ClientActions(session);
    actions.startCaptures();
    var bridge = new LocalBridge(session, actions);
    ClientTickEvents.END_CLIENT_TICK.register(actions::tick);
    ClientLifecycleEvents.CLIENT_STARTED.register(
        client -> {
          client.options.pauseOnLostFocus = false;
          client.options.fov().set(70);
          client.options.guiScale().set(2);
          client
              .options
              .inactivityFpsLimit()
              .set(net.minecraft.client.InactivityFpsLimit.MINIMIZED);
          bridge.start(client);
          var data = new ServerData("Storm Preview", session.server(), ServerData.Type.OTHER);
          ConnectScreen.startConnecting(
              new TitleScreen(),
              client,
              ServerAddress.parseString(session.server()),
              data,
              false,
              null);
        });
    ClientLifecycleEvents.CLIENT_STOPPING.register(
        client -> {
          actions.release(client);
          actions.closeCaptures(client);
          bridge.close();
        });
  }

  private static Session readSession(String file) {
    try {
      return Session.read(Path.of(file));
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read preview session", e);
    }
  }
}
