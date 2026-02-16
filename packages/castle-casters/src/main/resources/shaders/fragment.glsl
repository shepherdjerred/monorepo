#version 330 core

in VertexOutput {
    vec2 textureCoordinate;
} inputs;

layout (location = 0) out vec4 outColor;

uniform sampler2D texture_sampler;

void main() {
    outColor = texture(texture_sampler, inputs.textureCoordinate);
    if (outColor.a == 0) {
        discard;
    }
}
