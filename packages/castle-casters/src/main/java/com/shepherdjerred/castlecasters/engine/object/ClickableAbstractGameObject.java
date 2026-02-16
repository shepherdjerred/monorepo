package com.shepherdjerred.castlecasters.engine.object;

import com.shepherdjerred.castlecasters.engine.collision.CollisionDetector;
import com.shepherdjerred.castlecasters.engine.scene.attributes.Clickable;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import lombok.Getter;

public abstract class ClickableAbstractGameObject extends HoverableAbstractGameObject implements
    Clickable {

  private final Runnable onClick;
  private final Runnable onUnclick;
  @Getter
  private boolean isClicked;

  public ClickableAbstractGameObject(GameObjectRenderer renderer,
                                     SceneObjectDimensions objectDimensions,
                                     ScenePositioner positioner,
                                     CollisionDetector collisionDetector,
                                     Runnable onHover,
                                     Runnable onUnhover,
                                     Runnable onClick,
                                     Runnable onUnclick) {
    super(renderer, objectDimensions, positioner, collisionDetector, onHover, onUnhover);
    this.onClick = onClick;
    this.onUnclick = onUnclick;
  }

  public ClickableAbstractGameObject(GameObjectRenderer renderer,
                                     SceneObjectDimensions objectDimensions,
                                     ScenePositioner positioner,
                                     CollisionDetector collisionDetector,
                                     Runnable onHover,
                                     Runnable onClick) {
    super(renderer, objectDimensions, positioner, collisionDetector, onHover);
    this.onClick = onClick;
    this.onUnclick = null;
  }

  public ClickableAbstractGameObject(GameObjectRenderer renderer,
                                     SceneObjectDimensions objectDimensions,
                                     ScenePositioner positioner,
                                     CollisionDetector collisionDetector, Runnable onClick) {
    super(renderer, objectDimensions, positioner, collisionDetector);
    this.onClick = onClick;
    this.onUnclick = null;
  }

  @Override
  public void onClickBegin() {
    this.isClicked = true;
    if (onClick != null) {
      onClick.run();
    }
  }

  @Override
  public void onClickEnd() {
    this.isClicked = false;
    if (onUnclick != null) {
      onUnclick.run();
    }
  }

  @Override
  public void onClickAbort() {
    this.isClicked = false;
  }

  public State getState() {
    if (isClicked) {
      return State.CLICKED;
    } else if (isHovered()) {
      return State.HOVERED;
    } else {
      return State.INACTIVE;
    }
  }

  public enum State {
    INACTIVE, HOVERED, CLICKED
  }
}
