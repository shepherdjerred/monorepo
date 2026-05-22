package com.shepherdjerred.castlecasters.game.network.manager;

import com.shepherdjerred.castlecasters.common.Constants;
import com.shepherdjerred.castlecasters.common.GameState;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.network.client.NetworkClient;
import com.shepherdjerred.castlecasters.game.network.discovery.ServerDiscoverer;
import com.shepherdjerred.castlecasters.game.network.discovery.netty.NettyServerDiscoverer;
import com.shepherdjerred.castlecasters.game.network.manager.event.*;
import com.shepherdjerred.castlecasters.server.GameServer;

import java.net.InetSocketAddress;
import java.net.SocketAddress;

public class NetworkManager {

  private final EventBus<Event> eventBus;
  private final EventHandlerFrame<Event> eventHandlerFrame;
  private GameServer gameServer = null;
  private NetworkClient networkClient = null;
  private ServerDiscoverer discoverer = null;
  private Thread serverThread;
  private Thread clientThread;
  private Thread discoveryThread;

  public NetworkManager(EventBus<Event> eventBus) {
    this.eventBus = eventBus;
    this.eventHandlerFrame = new EventHandlerFrame<>();
    initializeEventHandlerFrame();
  }

  private void initializeEventHandlerFrame() {
    eventHandlerFrame.registerHandler(StartServerEvent.class, (event) -> createServer(event.gameState()));
    eventHandlerFrame.registerHandler(StopClientEvent.class, (event) -> stopClient());
    eventHandlerFrame.registerHandler(StopServerEvent.class, (event) -> stopServer());
    eventHandlerFrame.registerHandler(ConnectServerEvent.class, (event) -> connectClient(event.address()));
    eventHandlerFrame.registerHandler(StartDiscoveryEvent.class, (event) -> startDiscovery());
    eventHandlerFrame.registerHandler(StopDiscoveryEvent.class, (event) -> stopDiscovery());
    eventHandlerFrame.registerHandler(ShutdownNetworkEvent.class, (event) -> shutdown());
  }

  public void initialize() {
    eventBus.registerHandlerFrame(eventHandlerFrame);
  }

  public void update() {
    if (networkClient != null) {
      networkClient.update();
    }
    if (discoverer != null) {
      var event = discoverer.getEvent();
      event.ifPresent(eventBus::dispatch);
    }
  }

  private void connectClient(SocketAddress address) {
    networkClient = new NetworkClient(eventBus);
    clientThread = new Thread(() -> networkClient.connect(address), "CLIENT_NETWORK");
    clientThread.start();
  }

  private void createServer(GameState gameState) {
    gameServer = new GameServer(gameState,
        new InetSocketAddress(Constants.GAME_PORT),
        new InetSocketAddress(Constants.DISCOVERY_PORT));
    serverThread = new Thread(gameServer, "GAME_SERVER");
    serverThread.start();
  }

  private void startDiscovery() {
    discoverer = new NettyServerDiscoverer();
    discoveryThread = new Thread(discoverer, "DISCOVERY");
    discoveryThread.start();
  }

  private void stopDiscovery() {
    if (discoverer != null) {
      discoverer.stop();
      discoverer = null;
    }
  }

  private void stopServer() {
    if (gameServer != null) {
      gameServer.shutdown();
      gameServer = null;
    }
  }

  private void stopClient() {
    if (networkClient != null) {
      networkClient.shutdown();
      networkClient = null;
    }
  }

  public void shutdown() {
    eventBus.removeHandlerFrame(eventHandlerFrame);
    stopDiscovery();
    stopClient();
    stopServer();
  }

}
