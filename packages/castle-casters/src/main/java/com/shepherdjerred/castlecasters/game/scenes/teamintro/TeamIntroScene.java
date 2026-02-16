package com.shepherdjerred.castlecasters.game.scenes.teamintro;

import com.shepherdjerred.castlecasters.engine.events.scene.SceneTransitionEvent;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.AbstractUIScene;
import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.HorizontalPosition;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner.VerticalPosition;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.game.objects.logo.Logo;
import com.shepherdjerred.castlecasters.game.scenes.mainmenu.MainMenuScene;
import lombok.extern.log4j.Log4j2;

import java.util.LinkedHashSet;
import java.util.Set;

@Log4j2
public class TeamIntroScene extends AbstractUIScene {

  private final EventBus<Event> eventBus;
  private float time = 0;
  private boolean hasTransitioned = false;

  public TeamIntroScene(ResourceManager resourceManager,
                        EventBus<Event> eventBus,
                        WindowSize windowSize) {
    super(resourceManager,
        windowSize,
        new TeamIntroRenderer(resourceManager, windowSize));
    this.eventBus = eventBus;
  }

  protected Set<GameObject> createGameObjects() {
    Set<GameObject> gameObjects = new LinkedHashSet<>();

    var logo = new Logo(resourceManager,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.CENTER,
            new SceneCoordinateOffset(0, 0),
            100),
        1.102292769,
        300,
        Logo.Type.TEAM);

    gameObjects.add(logo);

    return gameObjects;
  }

  @Override
  public void updateState(float interval) {
    super.updateState(interval);
    time += interval;
    // TODO: make this configurable
    if (time > 0 && !hasTransitioned) {
      eventBus.dispatch(new SceneTransitionEvent(new MainMenuScene(
          resourceManager,
          eventBus,
          windowSize)));
      hasTransitioned = true;
    }
  }
}
