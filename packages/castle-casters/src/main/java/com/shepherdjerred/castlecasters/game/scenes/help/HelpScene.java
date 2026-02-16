package com.shepherdjerred.castlecasters.game.scenes.help;

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
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground;
import com.shepherdjerred.castlecasters.game.objects.button.Button.Type;
import com.shepherdjerred.castlecasters.game.objects.text.Text;
import com.shepherdjerred.castlecasters.game.objects.textbutton.TextButton;
import com.shepherdjerred.castlecasters.game.scenes.lobby.host.SimpleSceneRenderer;
import com.shepherdjerred.castlecasters.game.scenes.mainmenu.MainMenuScene;

import java.util.LinkedHashSet;
import java.util.Set;

public class HelpScene extends InteractableUIScene {

  private final EventBus<Event> eventBus;

  public HelpScene(ResourceManager resourceManager,
                   WindowSize windowSize,
                   EventBus<Event> eventBus) {
    super(windowSize,
        resourceManager,
        new SimpleSceneRenderer(resourceManager, windowSize),
        eventBus);
    this.eventBus = eventBus;
  }

  protected Set<GameObject> createGameObjects() {
    Set<GameObject> gameObjects = new LinkedHashSet<>();

    var text = new Text(resourceManager,
        """
            Castle Casters is a board game where the goal is to get your witch or wizard to the \
            other side. What makes Castle Casters special is your ability to cast magical walls!

            Making a Turn: On any turn, a player may either cast a wall or move their wizard.

            Placing a Wall: Walls are two spaces across and can be used to block the opposing \
            wizard. You cannot block any wizard from reaching the goal completely, but you may \
            use walls to make their route much longer. Each player has 10 walls.\
             Right click the mouse to place a horizontal wall. Right click and hold V to place a vertical wall.

            Moving the Wizard: Wizards can be moved up, down, left, or right. They cannot be \
            moved diagonally unless they are jumping.

            Jumping Rules: When you find yourself face to face with an opponent, you may jump them. \
            If there is a wall or other obstruction behind your opponent, you may jump \
            diagonally to the left or right of the opponent's wizard.""",
        FontName.M5X7,
        Color.white(),
        12,
        500,
        new WindowRelativeScenePositioner(HorizontalPosition.CENTER,
            VerticalPosition.CENTER,
            new SceneCoordinateOffset(0, 0),
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
          eventBus.dispatch(new SceneTransitionEvent(scene));
        });

    background = new ParallaxBackground(resourceManager, windowSize,
        ParallaxBackground.Type.random());

    gameObjects.add(text);
    gameObjects.add(backButton);

    return gameObjects;
  }
}
