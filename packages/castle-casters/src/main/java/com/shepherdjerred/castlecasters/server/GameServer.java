package com.shepherdjerred.castlecasters.server;

import com.shepherdjerred.castlecasters.common.GameState;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventLoggerHandler;
import com.shepherdjerred.castlecasters.server.game.GameLogic;
import com.shepherdjerred.castlecasters.server.network.manager.NetworkManager;
import com.shepherdjerred.castlecasters.server.network.manager.events.StartNetworkEvent;
import com.shepherdjerred.castlecasters.server.network.manager.events.StopBroadcastEvent;
import com.shepherdjerred.castlecasters.server.network.manager.events.StopNetworkEvent;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import java.net.SocketAddress;
import java.util.Set;

@Log4j2
@ToString
public class GameServer implements Runnable {

  private final EventBus<Event> eventBus;
  private final NetworkManager networkManager;
  private final GameLogic gameLogic;

  public GameServer(GameState gameState,
                    SocketAddress gameAddress,
                    SocketAddress broadcastAddress) {
    eventBus = new EventBus<>();
    gameLogic = new GameLogic(gameState, eventBus);
    networkManager = new NetworkManager(gameAddress, broadcastAddress, eventBus);

    registerEventHandlers();
  }

  private void registerEventHandlers() {
    eventBus.registerHandler(new EventLoggerHandler<>(Set.of()));
  }

  @Override
  public void run() {
    final int ticksPerSecond = 10;
    final int millisecondsPerSecond = 1000;
    final int sleepMilliseconds = millisecondsPerSecond / ticksPerSecond;

    eventBus.dispatch(new StartNetworkEvent());

    //noinspection InfiniteLoopStatement
    // TODO: stop this when the host leaves the lobby
    while (true) {
      networkManager.update();
      try {
        //noinspection BusyWait
        Thread.sleep(sleepMilliseconds);
      } catch (InterruptedException e) {
        log.error(e);
      }
    }
  }

  public void shutdown() {
    eventBus.dispatch(new StopBroadcastEvent());
    eventBus.dispatch(new StopNetworkEvent());
  }
}
