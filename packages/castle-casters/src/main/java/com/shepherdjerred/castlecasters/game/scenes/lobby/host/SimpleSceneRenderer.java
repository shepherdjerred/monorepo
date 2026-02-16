package com.shepherdjerred.castlecasters.game.scenes.lobby.host;

import com.shepherdjerred.castlecasters.engine.graphics.Color;
import com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper;
import com.shepherdjerred.castlecasters.engine.graphics.matrices.ProjectionMatrix;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgram;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgramName;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderUniform;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.Scene;
import com.shepherdjerred.castlecasters.engine.scene.SceneRenderer;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class SimpleSceneRenderer implements SceneRenderer<Scene> {

  private final ResourceManager resourceManager;
  private final WindowSize windowSize;
  private ProjectionMatrix projectionMatrix;
  private ShaderProgram defaultShaderProgram;
  private ShaderProgram textShaderProgram;

  public SimpleSceneRenderer(ResourceManager resourceManager, WindowSize windowSize) {
    this.resourceManager = resourceManager;
    this.windowSize = windowSize;
  }

  @Override
  public void render(Scene scene) {
    OpenGlHelper.clearScreen();
    updateProjectionMatrix();

    defaultShaderProgram.bind();
    defaultShaderProgram.setUniform(ShaderUniform.PROJECTION_MATRIX, projectionMatrix.getMatrix());
    textShaderProgram.bind();
    textShaderProgram.setUniform(ShaderUniform.PROJECTION_MATRIX, projectionMatrix.getMatrix());

    // sort by Z index
    // this is important for transparency support
    scene.getGameObjects().stream().sorted((left, right) -> {
      var leftPos = left.getPosition()
          .getSceneCoordinate(windowSize, left.getSceneObjectDimensions());
      var rightPos = right.getPosition().getSceneCoordinate(windowSize, right.getSceneObjectDimensions());
      return Float.compare(leftPos.z(), rightPos.z());
    }).forEach(element -> element.render(windowSize));
  }

  @Override
  public void initialize(Scene scene) throws Exception {
    updateProjectionMatrix();
    createShaderProgram();
    OpenGlHelper.setClearColor(Color.black());
    OpenGlHelper.enableTransparency();
    OpenGlHelper.enableDepthBuffer();

    for (GameObject gameObject : scene.getGameObjects()) {
      gameObject.initialize();
    }
  }

  private void createShaderProgram() throws Exception {
    defaultShaderProgram = resourceManager.get(ShaderProgramName.DEFAULT);
    textShaderProgram = resourceManager.get(ShaderProgramName.TEXT);
  }

  private void updateProjectionMatrix() {
    projectionMatrix = new ProjectionMatrix(windowSize);
  }

  @Override
  public void cleanup() {
    resourceManager.free(defaultShaderProgram.getShaderProgramName());
    resourceManager.free(textShaderProgram.getShaderProgramName());
  }
}
