package com.shepherdjerred.castlecasters.game.objects.background.parallax;

import com.shepherdjerred.castlecasters.engine.graphics.RendererCoordinate;
import com.shepherdjerred.castlecasters.engine.graphics.matrices.ModelMatrix;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.Mesh;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgram;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgramName;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderUniform;
import com.shepherdjerred.castlecasters.engine.graphics.texture.Texture;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.extern.log4j.Log4j2;

import java.util.Map.Entry;
import java.util.SortedMap;
import java.util.TreeMap;

@Log4j2
public class ParallaxBackgroundRenderer implements
    GameObjectRenderer<ParallaxBackground> {

  private final ResourceManager resourceManager;
  private final SortedMap<Integer, Texture> textureMap;
  private final WindowSize windowSize;
  private final ParallaxTexturesMapper mapper;
  private Mesh mesh;
  private ShaderProgram shaderProgram;

  public ParallaxBackgroundRenderer(ResourceManager resourceManager, WindowSize windowSize) {
    this.resourceManager = resourceManager;
    this.windowSize = windowSize;
    this.textureMap = new TreeMap<>();
    mapper = new ParallaxTexturesMapper();
  }

  @Override
  public void initialize(ParallaxBackground gameObject) throws Exception {
    var width = windowSize.width();
    var height = windowSize.height();

    var type = gameObject.getType();

    shaderProgram = resourceManager.get(ShaderProgramName.DEFAULT);
    var textures = mapper.get(type);

    for (Entry<Integer, LayerData> entry : textures.getLayers().entrySet()) {
      Integer layer = entry.getKey();
      TextureName texture = entry.getValue().textureName();
      textureMap.put(layer, resourceManager.get(texture));
    }

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

    mesh = new Mesh(vertices, textureCoordinates, indices);
  }

  @Override
  public void render(WindowSize windowSize, ParallaxBackground gameObject) {
    shaderProgram.bind();

    gameObject.getInstances().forEach((instance, layers) -> layers.forEach((layer, position) -> {
      var xpos = position * windowSize.width();
      var model = new ModelMatrix(new RendererCoordinate(xpos, 0, -1000 + layer),
          0,
          1).getMatrix();
      shaderProgram.setUniform(ShaderUniform.MODEL_MATRIX, model);
      var texture = textureMap.get(layer);
      texture.bind();
      mesh.render();
    }));
    shaderProgram.unbind();
  }

  @Override
  public void cleanup() {
    textureMap.values().forEach(texture -> resourceManager.free(texture.textureName()));
    resourceManager.free(shaderProgram.getShaderProgramName());
  }
}
