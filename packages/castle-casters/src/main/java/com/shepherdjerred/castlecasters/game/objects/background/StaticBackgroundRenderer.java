package com.shepherdjerred.castlecasters.game.objects.background;

import com.shepherdjerred.castlecasters.engine.graphics.mesh.Mesh;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.TexturedMesh;
import com.shepherdjerred.castlecasters.engine.graphics.texture.Texture;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;

public class StaticBackgroundRenderer implements
    GameObjectRenderer<StaticBackground> {

  private final ResourceManager resourceManager;
  private final WindowSize windowSize;
  private TexturedMesh texturedMesh;

  public StaticBackgroundRenderer(ResourceManager resourceManager, WindowSize windowSize) {
    this.windowSize = windowSize;
    this.resourceManager = resourceManager;
  }

  @Override
  public void initialize(StaticBackground gameObject) throws Exception {
    var width = windowSize.width();
    var height = windowSize.height();

    Texture texture;
    var type = gameObject.getType();

    texture = switch (type) {
      case PURPLE_MOUNTAINS -> resourceManager.get(TextureName.PURPLE_MOUNTAINS);
      default -> throw new UnsupportedOperationException(gameObject.getType().toString());
    };

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
    texturedMesh = new TexturedMesh(mesh, texture);
  }

  @Override
  public void render(WindowSize windowSize, StaticBackground sceneElement) {
    // TODO bind shader program, etc.
    texturedMesh.render();
  }

  @Override
  public void cleanup() {
    resourceManager.free(texturedMesh.texture().textureName());
    texturedMesh.mesh().cleanup();
  }
}
