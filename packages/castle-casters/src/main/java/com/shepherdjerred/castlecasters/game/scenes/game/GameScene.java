package com.shepherdjerred.castlecasters.game.scenes.game;

import com.shepherdjerred.castlecasters.common.player.Element;
import com.shepherdjerred.castlecasters.engine.events.input.KeyPressedEvent;
import com.shepherdjerred.castlecasters.engine.events.input.KeyReleasedEvent;
import com.shepherdjerred.castlecasters.engine.events.input.MouseButtonDownEvent;
import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.input.keyboard.Key;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseButton;
import com.shepherdjerred.castlecasters.engine.map.GameMapName;
import com.shepherdjerred.castlecasters.engine.map.MapCoordinate;
import com.shepherdjerred.castlecasters.engine.map.MapToQuoridorConverter;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.Scene;
import com.shepherdjerred.castlecasters.engine.scene.position.MapCoordinateScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;
import com.shepherdjerred.castlecasters.engine.scene.position.WindowRelativeScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.event.events.DoTurnEvent;
import com.shepherdjerred.castlecasters.game.event.events.TryDoTurnEvent;
import com.shepherdjerred.castlecasters.game.objects.game.map.MapObject;
import com.shepherdjerred.castlecasters.game.objects.game.wall.Wall;
import com.shepherdjerred.castlecasters.game.objects.game.wizard.Wizard;
import com.shepherdjerred.castlecasters.game.objects.text.Text;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.*;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;

import java.util.*;

import static com.shepherdjerred.castlecasters.game.Constants.RENDER_TILE_RESOLUTION;

@Log4j2
public class GameScene implements Scene {

  private final ResourceManager resourceManager;
  private final EventBus<Event> eventBus;
  private final GameRenderer gameRenderer;
  @Getter
  private final Set<GameObject> gameObjects;
  private final GameMapName gameMapName;
  private final QuoridorPlayer player;
  private final EventHandlerFrame<Event> eventHandlerFrame;
  private final Map<Key, Boolean> pressedKeys;
  private final Map<QuoridorPlayer, Wizard> wizards;
  private MapObject mapObject;
  private Match match;
  private Text text;

  public GameScene(ResourceManager resourceManager,
                   EventBus<Event> eventBus,
                   GameMapName gameMapName,
                   Match match,
                   QuoridorPlayer player,
                   WindowSize windowSize) {
    this.resourceManager = resourceManager;
    this.eventBus = eventBus;
    this.gameRenderer = new GameRenderer(resourceManager, eventBus, windowSize);
    this.gameObjects = new LinkedHashSet<>();
    this.gameMapName = gameMapName;
    this.eventHandlerFrame = new EventHandlerFrame<>();
    this.player = player;
    this.match = match;
    this.wizards = new HashMap<>();
    pressedKeys = new HashMap<>();

    createGameObjects();
  }

  @Override
  public void initialize() throws Exception {
    var players = match.matchSettings().playerCount();
    for (int i = 1; i < players.toInt() + 1; i++) {
      var player = QuoridorPlayer.fromInt(i);
      var boardPos = match.board().getPawnLocation(player);
      var converter = new MapToQuoridorConverter();
      var mapPos = converter.convert(boardPos);
      var wizard = new Wizard(resourceManager,
          new MapCoordinateScenePositioner(new SceneCoordinateOffset(0, 0), mapPos, 10),
          Element.FIRE,
          new SceneObjectDimensions(32, 32));
      wizards.put(player, wizard);
    }

    gameObjects.addAll(wizards.values());


    gameRenderer.initialize(this);
    for (GameObject gameObject : gameObjects) {
      gameObject.initialize();
    }

    createEventHandlerFrame();
    eventBus.registerHandlerFrame(eventHandlerFrame);
  }

  private void createEventHandlerFrame() {
    var turnHandler = new EventHandler<DoTurnEvent>() {
      @Override
      public void handle(DoTurnEvent event) {
        var turn = event.turn();
        var player = match.getActivePlayerId();
        match = match.doTurn(turn);

        var converter = new MapToQuoridorConverter();

        if (turn instanceof MovePawnTurn) {
          var boardPos = match.board().getPawnLocation(player);
          var mapPos = converter.convert(boardPos);
          var wizard = wizards.get(player);
          wizard.setPosition(new MapCoordinateScenePositioner(new SceneCoordinateOffset(0, 0), mapPos, 10));
        }
        if (turn instanceof PlaceWallTurn) {
          // TO create wall and position it
          var pos = ((PlaceWallTurn) turn).location();
          var coord1 = pos.firstCoordinate();
          var coord2 = pos.secondCoordinate();
          var coord3 = pos.vertex();
          var mapCoord1 = converter.convert(coord1);
          var mapCoord2 = converter.convert(coord2);
          var mapCoord3 = converter.convert(coord3);
          var wall1 = new Wall(resourceManager,
              new SceneObjectDimensions(24, 24),
              new MapCoordinateScenePositioner(new SceneCoordinateOffset(0, 0), mapCoord1, 10));
          var wall2 = new Wall(resourceManager,
              new SceneObjectDimensions(24, 24),
              new MapCoordinateScenePositioner(new SceneCoordinateOffset(0, 0), mapCoord2, 10));
          var wall3 = new Wall(resourceManager,
              new SceneObjectDimensions(24, 24),
              new MapCoordinateScenePositioner(new SceneCoordinateOffset(0, 0), mapCoord3, 10));

          try {
            wall1.initialize();
            wall2.initialize();
            wall3.initialize();
          } catch (Exception e) {
            log.error("Error occurred while initializing wall object.", e);
          }

          gameObjects.add(wall1);
          gameObjects.add(wall2);
          gameObjects.add(wall3);
        }

        // remove the old text object
        gameObjects.remove(text);
        // Update text
        var activePlayer = match.getActivePlayerId();
        var nextPlayer = match.getNextActivePlayerId();
        var textString = "Player " + activePlayer.toInt() + "'s turn";
        if (activePlayer == player) {
          textString += " (Your turn)";
        }
        textString += "\nNext player: " + nextPlayer.toInt();
        // create a new text object with the updated text
        text = new Text(resourceManager,
            textString,
            FontName.M5X7,
            Color.white(),
            12,
            100,
            new WindowRelativeScenePositioner(WindowRelativeScenePositioner.HorizontalPosition.LEFT,
                WindowRelativeScenePositioner.VerticalPosition.TOP,
                new SceneCoordinateOffset(0, 0),
                10));
        try {
          text.initialize();
        } catch (Exception e) {
          throw new RuntimeException(e);
        }
        // add the new text object
        gameObjects.add(text);
        // do we need to do any cleanup with the resource manager?
      }
    };

    var keyDownHandler = new EventHandler<KeyPressedEvent>() {
      @Override
      public void handle(KeyPressedEvent keyPressedEvent) {
        pressedKeys.put(keyPressedEvent.key(), true);
      }
    };

    var keyUpHandler = new EventHandler<KeyReleasedEvent>() {
      @Override
      public void handle(KeyReleasedEvent keyReleasedEvent) {
        pressedKeys.remove(keyReleasedEvent.key());
      }
    };

    eventHandlerFrame.registerHandler(DoTurnEvent.class, turnHandler);
    eventHandlerFrame.registerHandler(KeyPressedEvent.class, keyDownHandler);
    eventHandlerFrame.registerHandler(KeyReleasedEvent.class, keyUpHandler);
    eventHandlerFrame.registerHandler(MouseButtonDownEvent.class, (event) -> {
      var activePlayer = match.getActivePlayerId();

      if (activePlayer != player) {
        return;
      }

      var converter = new MapToQuoridorConverter();

      var tileSize = RENDER_TILE_RESOLUTION;
      var mapX = (event.mouseCoordinate().x() / tileSize);
      var mapY = (event.mouseCoordinate().y() / tileSize);

      var destination = converter.convert(new MapCoordinate(mapX, mapY));

      log.info(destination);

      if (destination == null) {
        return;
      }

      if (event.button() == MouseButton.LEFT) {
        var turn = getMovePawnTurn(match, destination);
        turn.ifPresent(value -> eventBus.dispatch(new TryDoTurnEvent(value)));
      } else if (event.button() == MouseButton.RIGHT) {
        Turn turn;
        if (pressedKeys.getOrDefault(Key.V, false)) {
          var posX = destination.x();
          var posY = destination.y();
          turn = new PlaceWallTurn(activePlayer,
              new WallLocation(new Coordinate(posX, posY),
                  new Coordinate(posX, posY + 1),
                  new Coordinate(posX, posY + 2)));
        } else {
          var posX = destination.x();
          var posY = destination.y();
          turn = new PlaceWallTurn(activePlayer,
              new WallLocation(new Coordinate(posX, posY),
                  new Coordinate(posX + 1, posY),
                  new Coordinate(posX + 2, posY)));
        }
        eventBus.dispatch(new TryDoTurnEvent(turn));
      }
    });
  }

  private Optional<Turn> getMovePawnTurn(Match match, Coordinate destination) {
    var board = match.board();
    var source = board.getPawnLocation(player);

    if (source.getManhattanDistanceTo(destination) == 4) {
      var sourceX = source.x();
      var sourceY = source.y();
      var destX = destination.x();
      var destY = destination.y();
      if (source.isCardinalTo(destination)) {
        Coordinate pivot;
        if (destX > sourceX) {
          // right
          pivot = source.toRight(2);
        } else if (destX < sourceX) {
          // left
          pivot = source.toLeft(2);
        } else if (destY > sourceY) {
          // up
          pivot = source.above(2);
        } else if (destY < sourceY) {
          // down
          pivot = source.below(2);
        } else {
          return Optional.empty();
        }

        var jumpStraightTurn = new JumpPawnStraightTurn(player, source, destination, pivot);
        return Optional.of(jumpStraightTurn);
      } else {
        if (destY > sourceY) {
          // Going up
          if (destX > sourceX) {
            // Going right
            var abovePivot = source.above(2);
            var rightPivot = source.toRight(2);
            if (board.hasPiece(abovePivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, abovePivot);
              return Optional.of(turn);
            } else if (board.hasPiece(rightPivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, rightPivot);
              return Optional.of(turn);
            }
          } else {
            // Going left
            var abovePivot = source.above(2);
            var leftPivot = source.toLeft(2);
            if (board.hasPiece(abovePivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, abovePivot);
              return Optional.of(turn);
            } else if (board.hasPiece(leftPivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, leftPivot);
              return Optional.of(turn);
            }
          }
        } else {
          // Going down
          var belowPivot = source.below(2);
          if (destX > sourceX) {
            // Going right
            var rightPivot = source.toRight(2);
            if (board.hasPiece(belowPivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, belowPivot);
              return Optional.of(turn);
            } else if (board.hasPiece(rightPivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, rightPivot);
              return Optional.of(turn);
            }
          } else {
            // Going left
            var leftPivot = source.toLeft(2);
            if (board.hasPiece(belowPivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, belowPivot);
              return Optional.of(turn);
            } else if (board.hasPiece(leftPivot)) {
              var turn = new JumpPawnDiagonalTurn(player, source, destination, leftPivot);
              return Optional.of(turn);
            }
          }
        }
      }
    } else {
      var turn = new NormalMovePawnTurn(player, source, destination);
      return Optional.of(turn);
    }
    return Optional.empty();
  }

  private void createGameObjects() {
    mapObject = new MapObject(resourceManager, gameMapName);
    gameObjects.add(mapObject);
  }

  @Override
  public void cleanup() {
    gameObjects.forEach(GameObject::cleanup);
    gameRenderer.cleanup();
    resourceManager.free(gameMapName);
  }

  @Override
  public void updateState(float interval) {
    gameObjects.forEach(object -> object.update(interval));
  }

  @Override
  public void render(WindowSize windowSize) {
    gameRenderer.render(this);
  }
}
