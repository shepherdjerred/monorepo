package com.shepherdjerred.castlecasters.game.objects.button;

import com.shepherdjerred.castlecasters.engine.graphics.RendererCoordinate;
import com.shepherdjerred.castlecasters.engine.graphics.matrices.ModelMatrix;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.Mesh;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.TexturedMesh;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgram;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgramName;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderUniform;
import com.shepherdjerred.castlecasters.engine.graphics.texture.Texture;
import com.shepherdjerred.castlecasters.engine.object.ClickableAbstractGameObject.State;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;

public class ButtonRenderer implements GameObjectRenderer<Button> {

  private final ResourceManager resourceManager;
  private TexturedMesh normalMesh;
  private TexturedMesh hoveredMesh;
  private TexturedMesh clickedMesh;
  private ShaderProgram shaderProgram;

  public ButtonRenderer(ResourceManager resourceManager) {
    this.resourceManager = resourceManager;
  }

  @Override
  public void initialize(Button gameObject) throws Exception {
    var width = gameObject.getSceneObjectDimensions().width();
    var height = gameObject.getSceneObjectDimensions().height();

    var mapper = new ButtonTextureMapper();
    var textures = mapper.get(gameObject.getType());

    var normalTexture = (Texture) resourceManager.get(textures.getInactiveTexture());
    var hoveredTexture = (Texture) resourceManager.get(textures.getHoveredTexture());
    var clickedTexture = (Texture) resourceManager.get(textures.getClickedTexture());

    shaderProgram = resourceManager.get(ShaderProgramName.DEFAULT);

    var vertices = new float[]{
        0, 0, 0,
        0, height, 0,
        width, 0, 0,
        width, height, 0
    };

    var textureCoordinates = new float[]{
        0, 0,
        0, 1,
        1, 0,
        1, 1
    };

    var indices = new int[]{
        0, 1, 2,
        3, 1, 2
    };

    var mesh = new Mesh(vertices, textureCoordinates, indices);

    normalMesh = new TexturedMesh(mesh, normalTexture);
    hoveredMesh = new TexturedMesh(mesh, hoveredTexture);
    clickedMesh = new TexturedMesh(mesh, clickedTexture);
  }

  @Override
  public void render(WindowSize windowSize, Button gameObject) {
    var pos = gameObject.getPosition()
        .getSceneCoordinate(windowSize, gameObject.getSceneObjectDimensions());
    var model = new ModelMatrix(new RendererCoordinate(pos.x(), pos.y(), pos.z()),
        0,
        1).getMatrix();

    shaderProgram.bind();
    shaderProgram.setUniform(ShaderUniform.MODEL_MATRIX, model);

    if (gameObject.getState() == State.INACTIVE) {
      normalMesh.render();
    } else if (gameObject.getState() == State.HOVERED) {
      hoveredMesh.render();
    } else if (gameObject.getState() == State.CLICKED) {
      clickedMesh.render();
    }

    shaderProgram.unbind();
  }

  @Override
  public void cleanup() {
    clickedMesh.mesh().cleanup();
    hoveredMesh.mesh().cleanup();
    normalMesh.mesh().cleanup();
    resourceManager.free(normalMesh.texture().textureName());
    resourceManager.free(clickedMesh.texture().textureName());
    resourceManager.free(hoveredMesh.texture().textureName());
    resourceManager.free(shaderProgram.getShaderProgramName());
  }
}
