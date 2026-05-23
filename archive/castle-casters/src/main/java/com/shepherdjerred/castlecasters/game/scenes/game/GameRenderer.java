package com.shepherdjerred.castlecasters.game.scenes.game;

import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper;
import com.shepherdjerred.castlecasters.engine.graphics.matrices.ProjectionMatrix;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgram;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgramName;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderUniform;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.SceneRenderer;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;

public class GameRenderer implements SceneRenderer<GameScene> {

  private final ResourceManager resourceManager;
  private final EventBus<Event> eventBus;
  private final WindowSize windowSize;
  private final EventHandlerFrame<Event> eventHandlerFrame;
  private ProjectionMatrix projectionMatrix;
//  private ShaderProgram textShaderProgram;
  private ShaderProgram defaultShaderProgram;

  public GameRenderer(ResourceManager resourceManager,
                      EventBus<Event> eventBus,
                      WindowSize windowSize) {
    this.resourceManager = resourceManager;
    this.eventBus = eventBus;
    this.eventHandlerFrame = new EventHandlerFrame<>();
    this.windowSize = windowSize;
  }

  @Override
  public void initialize(GameScene scene) throws Exception {
    updateProjectionMatrix();
    createShaderProgram();
    OpenGlHelper.setClearColor(Color.black());
    OpenGlHelper.enableDepthBuffer();
    OpenGlHelper.enableTransparency();

    for (GameObject gameObject : scene.getGameObjects()) {
      gameObject.initialize();
    }

    eventBus.registerHandlerFrame(eventHandlerFrame);
  }

  private void createShaderProgram() throws Exception {
    defaultShaderProgram = resourceManager.get(ShaderProgramName.DEFAULT);
//    textShaderProgram = resourceManager.get(ShaderProgramName.TEXT);
  }

  @Override
  public void render(GameScene scene) {
    OpenGlHelper.clearScreen();
    updateProjectionMatrix();

    defaultShaderProgram.bind();
    defaultShaderProgram.setUniform(ShaderUniform.PROJECTION_MATRIX, projectionMatrix.getMatrix());

    scene.getGameObjects().forEach(element -> element.render(windowSize));
  }

  private void updateProjectionMatrix() {
    projectionMatrix = new ProjectionMatrix(windowSize);
  }

  @Override
  public void cleanup() {
    resourceManager.free(ShaderProgramName.TEXT);
    resourceManager.free(ShaderProgramName.DEFAULT);
    eventBus.removeHandlerFrame(eventHandlerFrame);
  }
}
