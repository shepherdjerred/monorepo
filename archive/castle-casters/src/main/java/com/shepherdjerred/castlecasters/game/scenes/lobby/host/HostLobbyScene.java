package com.shepherdjerred.castlecasters.game.scenes.lobby.host;

import com.shepherdjerred.castlecasters.common.Constants;
import com.shepherdjerred.castlecasters.common.GameMap;
import com.shepherdjerred.castlecasters.common.GameState;
import com.shepherdjerred.castlecasters.common.chat.ChatHistory;
import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.common.lobby.LobbySettings;
import com.shepherdjerred.castlecasters.common.lobby.LobbySettings.LobbyType;
import com.shepherdjerred.castlecasters.engine.events.scene.SceneTransitionEvent;
import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.InteractableUIScene;
import com.shepherdjerred.castlecasters.engine.scene.position.ObjectRelativeScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.HorizontalPosition;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.VerticalPosition;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.game.event.events.FillSlotsWithAiEvent;
import com.shepherdjerred.castlecasters.game.network.event.ServerConnectedEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.ConnectServerEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.ShutdownNetworkEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.StartClientEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.StartServerEvent;
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground;
import com.shepherdjerred.castlecasters.game.objects.button.Button.Type;
import com.shepherdjerred.castlecasters.game.objects.text.Text;
import com.shepherdjerred.castlecasters.game.objects.textbutton.TextButton;
import com.shepherdjerred.castlecasters.game.scenes.lobby.details.LobbyDetailsScene;
import com.shepherdjerred.castlecasters.game.scenes.mainmenu.MainMenuScene;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.extern.log4j.Log4j2;

import java.net.InetSocketAddress;
import java.util.LinkedHashSet;
import java.util.Set;

@Log4j2
public class HostLobbyScene extends InteractableUIScene {

  private final LobbySettings lobbySettings;
  private boolean isServerStarting;

  public HostLobbyScene(EventBus<Event> eventBus,
                        ResourceManager resourceManager,
                        WindowSize windowSize,
                        LobbyType lobbyType) {
    super(windowSize,
        resourceManager,
        new com.shepherdjerred.castlecasters.game.scenes.lobby.host.SimpleSceneRenderer(
            resourceManager,
            windowSize),
        eventBus);
    lobbySettings = new LobbySettings("My Lobby",
        new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO),
        lobbyType,
        false,
        GameMap.GRASS);
  }

  protected Set<GameObject> createGameObjects() {
    Set<GameObject> gameObjects = new LinkedHashSet<>();

    var title = new Text(resourceManager,
        "Lobby Setup",
        FontName.M5X7,
        Color.white(),
        12,
        200,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.TOP,
            new SceneCoordinateOffset(0, 100),
            0));

    var lobbyText = String.format("Walls per player: %d\nStarting player: %s\nPlayer count: %s\nMap: %s",
        lobbySettings.matchSettings().wallsPerPlayer(),
        lobbySettings.matchSettings().startingQuoridorPlayer(),
        lobbySettings.matchSettings().playerCount(),
        lobbySettings.gameMap().name());

    // add buttons to change:
    // walls per player
    // starting player
    // player count
    // map

    var lobbyDump = new Text(resourceManager,
        lobbyText,
        FontName.M5X7,
        Color.white(),
        14,
        300,
        new ObjectRelativeScenePositioner(title, new SceneCoordinateOffset(0, 75), 1));

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

    var nextButton = new TextButton(resourceManager,
        windowSize,
        new WindowRelativeScenePositioner(HorizontalPosition.RIGHT,
            VerticalPosition.BOTTOM,
            new SceneCoordinateOffset(-100, -100),
            1),
        "Next",
        FontName.M5X7,
        Color.white(),
        24,
        new SceneObjectDimensions(100, 50),
        Type.GENERIC,
        () -> {
          if (!isServerStarting) {
            isServerStarting = true;

            eventBus.dispatch(new StartServerEvent(createGameState()));

            // TODO wait for successful server creation
            eventBus.dispatch(new StartClientEvent());
            eventBus.dispatch(new ConnectServerEvent(new InetSocketAddress(Constants.GAME_PORT)));

            eventBus.registerHandler(ServerConnectedEvent.class, (event) -> {
              if (lobbySettings.lobbyType().equals(LobbyType.LOCAL)) {
                eventBus.dispatch(new FillSlotsWithAiEvent());
              }

              var scene = new LobbyDetailsScene(eventBus,
                  resourceManager,
                  windowSize,
                  QuoridorPlayer.ONE,
                  Lobby.from(lobbySettings),
                  true);
              eventBus.dispatch(new SceneTransitionEvent(scene));
            });
          } else {
            log.warn("Server is already starting");
          }
        });

    background = new ParallaxBackground(resourceManager, windowSize,
        ParallaxBackground.Type.random());

    gameObjects.add(lobbyDump);
    gameObjects.add(title);
    gameObjects.add(backButton);
    gameObjects.add(nextButton);
    return gameObjects;
  }

  private GameState createGameState() {
    return new GameState(Lobby.from(lobbySettings), null, new ChatHistory());
  }
}
