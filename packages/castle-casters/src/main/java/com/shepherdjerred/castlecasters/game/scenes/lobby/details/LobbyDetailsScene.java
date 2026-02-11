package com.shepherdjerred.castlecasters.game.scenes.lobby.details;

import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.engine.events.scene.SceneTransitionEvent;
import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.map.GameMapName;
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
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.event.events.StartGameEvent;
import com.shepherdjerred.castlecasters.game.event.events.TryStartGameEvent;
import com.shepherdjerred.castlecasters.game.network.manager.event.ShutdownNetworkEvent;
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground;
import com.shepherdjerred.castlecasters.game.objects.button.Button.Type;
import com.shepherdjerred.castlecasters.game.objects.text.Text;
import com.shepherdjerred.castlecasters.game.objects.textbutton.TextButton;
import com.shepherdjerred.castlecasters.game.scenes.game.GameScene;
import com.shepherdjerred.castlecasters.game.scenes.lobby.host.SimpleSceneRenderer;
import com.shepherdjerred.castlecasters.game.scenes.mainmenu.MainMenuScene;
import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

import java.util.LinkedHashSet;
import java.util.Set;

public class LobbyDetailsScene extends InteractableUIScene {

  private final boolean isHost;
  private final QuoridorPlayer player;
  private final Lobby lobby;
  private final EventBus<Event> eventBus;
  private final EventHandlerFrame<Event> eventHandlerFrame;

  public LobbyDetailsScene(EventBus<Event> eventBus,
                           ResourceManager resourceManager,
                           WindowSize windowSize,
                           QuoridorPlayer player,
                           Lobby lobby,
                           boolean isHost) {
    super(windowSize,
        resourceManager,
        new SimpleSceneRenderer(resourceManager, windowSize),
        eventBus);
    this.eventBus = eventBus;
    this.eventHandlerFrame = new EventHandlerFrame<>();
    this.lobby = lobby;
    this.isHost = isHost;
    this.player = player;
    createEventHandlerFrame();
    createGameObjects();
  }

  private void createEventHandlerFrame() {
    eventHandlerFrame.registerHandler(StartGameEvent.class, (event) -> {
      var lobbySettings = lobby.getLobbySettings();
      var matchSettings = lobbySettings.matchSettings();
      var map = lobbySettings.gameMap();
      var boardSettings = new BoardSettings(map.getBoardSize(), matchSettings.playerCount());
      var match = Match.from(matchSettings, boardSettings);

      var scene = new GameScene(resourceManager,
          eventBus,
          GameMapName.random(),
          match,
          player,
          windowSize);
      eventBus.dispatch(new SceneTransitionEvent(scene));
    });
  }

  protected Set<GameObject> createGameObjects() {
    Set<GameObject> gameObjects = new LinkedHashSet<>();
    var text = new Text(resourceManager,
        "Lobby",
        FontName.M5X7,
        Color.white(),
        24,
        100,
        new WindowRelativeScenePositioner(
            HorizontalPosition.CENTER, VerticalPosition.TOP, new SceneCoordinateOffset(0, 100), 1));

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
          eventBus.dispatch(new SceneTransitionEvent(scene));
          eventBus.dispatch(new ShutdownNetworkEvent());
        });

    var nextButton = new TextButton(resourceManager,
        windowSize,
        new WindowRelativeScenePositioner(HorizontalPosition.RIGHT,
            VerticalPosition.BOTTOM,
            new SceneCoordinateOffset(-100, -100),
            1),
        "Start",
        FontName.M5X7,
        Color.white(),
        24,
        new SceneObjectDimensions(100, 50),
        Type.GENERIC,
        () -> eventBus.dispatch(new TryStartGameEvent()));

    // TODO handle name updates
    var lobbyName = new Text(resourceManager,
        lobby.getLobbySettings().name(),
        FontName.M5X7,
        Color.white(),
        24,
        300,
        new ObjectRelativeScenePositioner(text, new SceneCoordinateOffset(0, 75), 1));

    var lobbySettings = lobby.getLobbySettings();

    var lobbyText = String.format("Walls per player: %d\nStarting player: %s\nPlayer count: %s\nMap: %s",
        lobbySettings.matchSettings().wallsPerPlayer(),
        lobbySettings.matchSettings().startingQuoridorPlayer(),
        lobbySettings.matchSettings().playerCount(),
        lobbySettings.gameMap().name());

    var lobbyDump = new Text(resourceManager,
        lobbyText,
        FontName.M5X7,
        Color.white(),
        24,
        300,
        new ObjectRelativeScenePositioner(lobbyName, new SceneCoordinateOffset(0, 75), 1));

    background = new ParallaxBackground(resourceManager, windowSize,
        ParallaxBackground.Type.random());

    gameObjects.add(lobbyName);
    gameObjects.add(lobbyDump);
    gameObjects.add(text);
    gameObjects.add(backButton);
    if (isHost) {
      gameObjects.add(nextButton);
    }
    return gameObjects;
  }

  @Override
  public void updateState(float interval) {
    super.updateState(interval);
  }

  @Override
  public void initialize() throws Exception {
    super.initialize();
    eventBus.registerHandlerFrame(eventHandlerFrame);
  }

  @Override
  public void cleanup() {
    super.cleanup();
    eventBus.removeHandlerFrame(eventHandlerFrame);
  }
}
