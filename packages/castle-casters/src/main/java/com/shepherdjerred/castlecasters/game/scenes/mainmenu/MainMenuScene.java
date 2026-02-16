package com.shepherdjerred.castlecasters.game.scenes.mainmenu;

import com.shepherdjerred.castlecasters.common.lobby.LobbySettings.LobbyType;
import com.shepherdjerred.castlecasters.engine.events.CloseApplicationEvent;
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
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground;
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground.Type;
import com.shepherdjerred.castlecasters.game.objects.logo.Logo;
import com.shepherdjerred.castlecasters.game.objects.textbutton.TextButton;
import com.shepherdjerred.castlecasters.game.scenes.help.HelpScene;
import com.shepherdjerred.castlecasters.game.scenes.lobby.host.HostLobbyScene;
import com.shepherdjerred.castlecasters.game.scenes.lobby.host.SimpleSceneRenderer;
import com.shepherdjerred.castlecasters.game.scenes.lobby.list.LobbyListScene;
import lombok.extern.log4j.Log4j2;

import java.util.LinkedHashSet;
import java.util.Set;

import static com.shepherdjerred.castlecasters.game.objects.button.Button.Type.GENERIC;

@Log4j2
public class MainMenuScene extends InteractableUIScene {

  private final ResourceManager resourceManager;
  private final WindowSize windowSize;
  private final MainMenuAudio sceneAudio;

  public MainMenuScene(ResourceManager resourceManager,
                       EventBus<Event> eventBus,
                       WindowSize windowSize) {
    super(windowSize,
        resourceManager,
        new SimpleSceneRenderer(resourceManager, windowSize),
        eventBus);
    this.resourceManager = resourceManager;
    this.windowSize = windowSize;
    this.sceneAudio = new MainMenuAudio(eventBus,
        resourceManager);
  }

  protected Set<GameObject> createGameObjects() {
    Set<GameObject> gameObjects = new LinkedHashSet<>();

    var logo = new Logo(resourceManager,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.TOP,
            new SceneCoordinateOffset(0, 50),
            0),
        1.485517919,
        200,
        Logo.Type.GAME);

    background = new ParallaxBackground(resourceManager, windowSize,
        Type.random());

    var buttonSize = new SceneObjectDimensions(200, 50);

    var singleplayerButton = new TextButton(resourceManager,
        windowSize,
        new ObjectRelativeScenePositioner(logo, new SceneCoordinateOffset(0, 200), 100),
        "Single Player",
        FontName.M5X7,
        Color.white(),
        12,
        buttonSize,
        GENERIC,
        () -> {
      log.info("Single player button clicked");
          var scene = new HostLobbyScene(eventBus,
              resourceManager,
              windowSize,
              LobbyType.LOCAL);
          eventBus.dispatch(new SceneTransitionEvent(scene));
        });

    var multiplayerButton = new TextButton(resourceManager,
        windowSize,
        new ObjectRelativeScenePositioner(singleplayerButton, new SceneCoordinateOffset(0, 75), 100),
        "Multiplayer",
        FontName.M5X7,
        Color.white(),
        12,
        buttonSize,
        GENERIC,
        () -> {
          var scene = new LobbyListScene(eventBus,
              resourceManager,
              windowSize);
          eventBus.dispatch(new SceneTransitionEvent(scene));
        });

    var helpButton = new TextButton(resourceManager,
        windowSize,
        new ObjectRelativeScenePositioner(multiplayerButton, new SceneCoordinateOffset(0, 75), 100),
        "Help",
        FontName.M5X7,
        Color.white(),
        12,
        buttonSize,
        GENERIC,
        () -> {
          var scene = new HelpScene(resourceManager, windowSize, eventBus);
          eventBus.dispatch(new SceneTransitionEvent(scene));
        });

    var exitButton = new TextButton(resourceManager,
        windowSize,
        new ObjectRelativeScenePositioner(helpButton, new SceneCoordinateOffset(0, 75), 100),
        "Exit",
        FontName.M5X7,
        Color.white(),
        12,
        buttonSize,
        GENERIC,
        () -> eventBus.dispatch(new CloseApplicationEvent()));

    gameObjects.add(singleplayerButton);
    gameObjects.add(multiplayerButton);
    gameObjects.add(helpButton);
    gameObjects.add(exitButton);
    gameObjects.add(logo);

    return gameObjects;
  }

  @Override
  public void initialize() throws Exception {
    super.initialize();
    sceneAudio.initialize();
  }

  @Override
  public void cleanup() {
    super.cleanup();
    sceneAudio.cleanup();
  }

}
