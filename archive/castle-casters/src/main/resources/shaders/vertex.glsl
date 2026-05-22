#version 330 core

layout (location = 0) in vec3 inPosition;
layout (location = 1) in vec2 inTextureCoordinate;

out VertexOutput {
    vec2 textureCoordinate;
} outputs;

uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;

void main() {
    gl_Position = projectionMatrix * modelMatrix * vec4(inPosition, 1.0);
    outputs.textureCoordinate = inTextureCoordinate;
}
