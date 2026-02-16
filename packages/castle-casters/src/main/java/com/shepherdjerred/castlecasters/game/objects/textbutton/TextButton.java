package com.shepherdjerred.castlecasters.game.objects.textbutton;

import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.scene.attributes.Clickable;
import com.shepherdjerred.castlecasters.engine.scene.attributes.Hoverable;
import com.shepherdjerred.castlecasters.engine.scene.position.ObjectRelativeScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.game.objects.button.Button;
import com.shepherdjerred.castlecasters.game.objects.button.Button.Type;
import com.shepherdjerred.castlecasters.game.objects.text.Text;
import lombok.Getter;

public class TextButton implements GameObject, Clickable, Hoverable {

  private final Text text;
  private final Button button;
  @Getter
  private boolean isInitialized;

  public TextButton(ResourceManager resourceManager,
                    WindowSize windowSize,
                    ScenePositioner positioner,
                    String text,
                    FontName fontName,
                    Color color,
                    int fontSize,
                    SceneObjectDimensions dimensions,
                    Type type,
                    Runnable onClick) {
    this.button = new Button(resourceManager,
        windowSize,
        positioner,
        dimensions,
        type,
        onClick);
    this.text = new Text(resourceManager,
        text,
        fontName,
        color,
        fontSize,
        dimensions.width(),
        new ObjectRelativeScenePositioner(button,
            new SceneCoordinateOffset(0, 0),
            (int) positioner.getSceneCoordinate(windowSize, dimensions).z() + 1));
  }

  @Override
  public void initialize() throws Exception {
    text.initialize();
    button.initialize();
    isInitialized = true;
  }

  @Override
  public void cleanup() {
    isInitialized = false;
    text.cleanup();
    button.cleanup();
  }

  @Override
  public SceneObjectDimensions getSceneObjectDimensions() {
    return button.getSceneObjectDimensions();
  }

  @Override
  public ScenePositioner getPosition() {
    return button.getPosition();
  }

  @Override
  public void setPosition(ScenePositioner scenePositioner) {
    button.setPosition(scenePositioner);
    text.setPosition(scenePositioner);
  }

  @Override
  public void render(WindowSize windowSize) {
    if (!isInitialized) {
      throw new IllegalStateException("Object not initialized " + this);
    }
    text.render(windowSize);
    button.render(windowSize);
  }

  @Override
  public void update(float interval) {

  }

  @Override
  public void onClickBegin() {
    button.onClickBegin();
  }

  @Override
  public void onClickAbort() {
    button.onClickAbort();
  }

  @Override
  public void onClickEnd() {
    button.onClickEnd();
  }

  @Override
  public boolean isClicked() {
    return button.isClicked();
  }

  @Override
  public void onHover() {
    button.onHover();
  }

  @Override
  public void onUnhover() {
    button.onUnhover();
  }

  @Override
  public boolean isHovered() {
    return button.isHovered();
  }

  @Override
  public boolean contains(SceneCoordinate sceneCoordinate) {
    return button.contains(sceneCoordinate);
  }
}
