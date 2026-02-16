package com.shepherdjerred.castlecasters.game.scenes.lobby.list;

import com.shepherdjerred.castlecasters.common.Constants;
import com.shepherdjerred.castlecasters.common.lobby.LobbySettings.LobbyType;
import com.shepherdjerred.castlecasters.common.player.PlayerInformation;
import com.shepherdjerred.castlecasters.engine.events.scene.SceneActiveEvent;
import com.shepherdjerred.castlecasters.engine.events.scene.SceneTransitionEvent;
import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.InteractableUIScene;
import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.HorizontalPosition;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.VerticalPosition;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.event.events.IdentifyPlayerEvent;
import com.shepherdjerred.castlecasters.game.network.discovery.ServerInformation;
import com.shepherdjerred.castlecasters.game.network.discovery.event.ServerDiscoveredEvent;
import com.shepherdjerred.castlecasters.game.network.event.ServerConnectedEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.ConnectServerEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.ShutdownNetworkEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.StartClientEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.StartDiscoveryEvent;
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground;
import com.shepherdjerred.castlecasters.game.objects.button.Button.Type;
import com.shepherdjerred.castlecasters.game.objects.text.Text;
import com.shepherdjerred.castlecasters.game.objects.textbutton.TextButton;
import com.shepherdjerred.castlecasters.game.scenes.lobby.details.LobbyDetailsScene;
import com.shepherdjerred.castlecasters.game.scenes.lobby.host.HostLobbyScene;
import com.shepherdjerred.castlecasters.game.scenes.lobby.host.SimpleSceneRenderer;
import com.shepherdjerred.castlecasters.game.scenes.mainmenu.MainMenuScene;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.extern.log4j.Log4j2;

import java.net.InetSocketAddress;
import java.util.*;

@Log4j2
public class LobbyListScene extends InteractableUIScene {

  private final EventHandlerFrame<Event> eventHandlerFrame;
  private final EventHandlerFrame<Event> connectingEventHandlerFrame;
  private final Map<ServerInformation, GameObject> serverInfoMap;
  private boolean isConnecting;

  public LobbyListScene(EventBus<Event> eventBus,
                        ResourceManager resourceManager,
                        WindowSize windowSize) {
    super(windowSize,
        resourceManager,
        new SimpleSceneRenderer(resourceManager, windowSize),
        eventBus);
    eventHandlerFrame = new EventHandlerFrame<>();
    connectingEventHandlerFrame = new EventHandlerFrame<>();
    serverInfoMap = new HashMap<>();
    createEventHandler();
    createConnectingEventHandler();
    eventBus.registerHandlerFrame(eventHandlerFrame);
    createGameObjects();
  }

  private void createConnectingEventHandler() {
    connectingEventHandlerFrame.registerHandler(ServerConnectedEvent.class, (event) -> {
      log.info("Lobby list: server connected.");
      eventBus.dispatch(new IdentifyPlayerEvent(new PlayerInformation(UUID.randomUUID(),
          UUID.randomUUID().toString())));
    });
  }

  private TextButton createTextObjectForServer(ServerInformation serverInformation) {
    String name;
    int taken;
    int total;

    if (serverInformation.lobby() == null) {
      name = "???";
      taken = -1;
      total = -1;
    } else {
      var lobby = serverInformation.lobby();
      name = lobby.getLobbySettings().name();
      taken = lobby.getTakenSlots();
      total = lobby.getMaxSlots();
    }

    var string = String.format("Name: %s | Players: %s/%s",
        name,
        taken,
        total);

    return new TextButton(resourceManager,
        windowSize,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.TOP,
            new SceneCoordinateOffset(0, serverInfoMap.size() * 60 + 60 + 150),
            0),
        string,
        FontName.M5X7,
        Color.white(),
        12,
        new SceneObjectDimensions(400, 50),
        Type.GENERIC,
        () -> {
          if (!isConnecting) {
            isConnecting = true;
            eventBus.registerHandlerFrame(connectingEventHandlerFrame);
            eventBus.dispatch(new StartClientEvent());
            var discoveryAddress = (InetSocketAddress) serverInformation.address();
            var gameAddress = new InetSocketAddress(discoveryAddress.getHostName(),
                Constants.GAME_PORT);
            eventBus.dispatch(new ConnectServerEvent(gameAddress));

            eventBus.registerHandler(ServerConnectedEvent.class, (event) -> {
              var scene = new LobbyDetailsScene(eventBus,
                  resourceManager,
                  windowSize,
                  QuoridorPlayer.TWO,
                  serverInformation.lobby(),
                  true);
              eventBus.dispatch(new SceneTransitionEvent(scene));
            });
          }

          // TODO detect connection failures
        });
  }

  private void createEventHandler() {
    eventHandlerFrame.registerHandler(ServerDiscoveredEvent.class,
        event -> {
          var eventServerInfo = event.serverInformation();

          for (ServerInformation info : serverInfoMap.keySet()) {
            if (eventServerInfo.lobby().getUuid().equals(info.lobby().getUuid())) {
              return;
            }
          }

          var text = createTextObjectForServer(eventServerInfo);
          try {
            text.initialize();
            serverInfoMap.put(eventServerInfo, text);
          } catch (Exception e) {
            log.error("Error occurred while initializing text object.", e);
          }
        });

    eventHandlerFrame.registerHandler(SceneActiveEvent.class,
        event -> eventBus.dispatch(new StartDiscoveryEvent()));
  }

  protected Set<GameObject> createGameObjects() {
    Set<GameObject> gameObjects = new LinkedHashSet<>();

    var title = new Text(resourceManager,
        "Lobby List",
        FontName.M5X7,
        Color.white(),
        24,
        600,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.TOP,
            new SceneCoordinateOffset(0, 100),
            0));

    var searching = new Text(resourceManager,
        "Searching for lobbies...",
        FontName.M5X7,
        Color.white(),
        24,
        600,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.TOP,
            new SceneCoordinateOffset(0, 150),
            0));

    var backButton = new TextButton(resourceManager,
        windowSize,
        new WindowRelativeScenePositioner(HorizontalPosition.LEFT,
            VerticalPosition.BOTTOM,
            new SceneCoordinateOffset(100, -100),
            1),
        "Back",
        FontName.M5X7,
        Color.white(),
        24,
        new SceneObjectDimensions(100, 50),
        Type.GENERIC,
        () -> {
          var scene = new MainMenuScene(resourceManager,
              eventBus,
              windowSize);
          eventBus.dispatch(new ShutdownNetworkEvent());
          eventBus.dispatch(new SceneTransitionEvent(scene));
        });

    var hostButton = new TextButton(resourceManager,
        windowSize,
        new WindowRelativeScenePositioner(HorizontalPosition.RIGHT,
            VerticalPosition.BOTTOM,
            new SceneCoordinateOffset(-100, -100),
            1),
        "Host",
        FontName.M5X7,
        Color.white(),
        24,
        new SceneObjectDimensions(100, 50),
        Type.GENERIC,
        () -> {
          var scene = new HostLobbyScene(eventBus,
              resourceManager, windowSize, LobbyType.NETWORK);
          eventBus.dispatch(new SceneTransitionEvent(scene));
        });

    background = new ParallaxBackground(resourceManager, windowSize,
        ParallaxBackground.Type.random());

    gameObjects.add(title);
    gameObjects.add(searching);
    gameObjects.add(backButton);
    gameObjects.add(hostButton);
    return gameObjects;
  }


  @Override
  public Set<GameObject> getGameObjects() {
    var original = super.getGameObjects();
    original.addAll(serverInfoMap.values());
    return original;
  }

  @Override
  public void cleanup() {
    super.cleanup();
    eventBus.removeHandlerFrame(eventHandlerFrame);
    eventBus.removeHandlerFrame(connectingEventHandlerFrame);
  }
}
