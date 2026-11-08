// Offscreen DXBC rasterization on D3D11 WARP. No window, browser or game process.
#include <d3d11.h>
#include <d3dcompiler.h>
#include <wrl/client.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using Bytes = std::vector<uint8_t>;
void check(HRESULT hr, const char* action) {
  if (FAILED(hr)) throw std::runtime_error(std::string(action) + " HRESULT " + std::to_string(static_cast<uint32_t>(hr)));
}
struct Reader {
  std::ifstream input;
  explicit Reader(const std::filesystem::path& path) : input(path, std::ios::binary) {
    if (!input) throw std::runtime_error("Cannot open oracle request");
  }
  Bytes fixed(size_t count) {
    Bytes data(count);
    if (count && !input.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(count))) throw std::runtime_error("Truncated oracle request");
    return data;
  }
  uint32_t word() { auto data = fixed(4); uint32_t result; std::memcpy(&result, data.data(), 4); return result; }
  Bytes blob(uint32_t maximum = 64 * 1024 * 1024) { auto size = word(); if (size > maximum) throw std::runtime_error("Oracle request exceeds its size bound"); return fixed(size); }
  std::string text() { auto data = blob(4096); if (std::find(data.begin(), data.end(), 0) != data.end()) throw std::runtime_error("Oracle name contains NUL"); return std::string(data.begin(), data.end()); }
  void done() { if (input.peek() != std::char_traits<char>::eof()) throw std::runtime_error("Unconsumed oracle request bytes"); }
};
struct Member {
  std::string name;
  uint32_t offset, size, used, scalar, rows, columns, elements, row_major;
};
struct BufferInput { uint32_t stage; std::string name; Bytes data; std::vector<Member> members; };
struct TextureInput { std::string name; uint32_t width, height; Bytes data; };
struct SamplerInput { std::string name; uint32_t address, filter; };
void exact(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

int wmain(int argc, wchar_t** argv) {
  try {
    exact(argc == 4 || argc == 5, "usage: shader-oracle <request.bin> <output.rgba> <reflection.json> [vertex-output.bin]");
    Reader reader(argv[1]);
    exact(reader.fixed(8) == Bytes({'S','C','D','X','B','C','0','1'}), "Unknown oracle request version");
    uint32_t width = reader.word(), height = reader.word();
    exact(width > 0 && height > 0 && width <= 4096 && height <= 4096, "Invalid oracle target size");
    uint32_t src = reader.word(), dst = reader.word();
    exact((src == D3D11_BLEND_ONE || src == D3D11_BLEND_SRC_ALPHA) && (dst == D3D11_BLEND_ZERO || dst == D3D11_BLEND_ONE || dst == D3D11_BLEND_INV_SRC_ALPHA), "Unimplemented oracle blend mode");
    auto vs_bytes = reader.blob(1024 * 1024), ps_bytes = reader.blob(1024 * 1024);
    auto vertices = reader.blob(1024 * 1024), indices = reader.blob(1024 * 1024);
    exact(!vertices.empty() && vertices.size() % 28 == 0 && !indices.empty() && indices.size() % 6 == 0, "Invalid native quad vertex/index data");
    for (size_t at = 0; at < indices.size(); at += 2) {
      uint16_t index; std::memcpy(&index, indices.data() + at, 2);
      exact(index < vertices.size() / 28, "Native quad index exceeds the vertex buffer");
    }
    uint32_t count = reader.word(); exact(count <= 32, "Too many oracle buffers");
    std::vector<BufferInput> buffers;
    for (uint32_t i = 0; i < count; ++i) {
      BufferInput value; value.stage = reader.word(); value.name = reader.text(); value.data = reader.blob(65536);
      exact(value.stage <= 1 && !value.data.empty() && value.data.size() % 16 == 0, "Invalid oracle constant buffer");
      uint32_t members = reader.word(); exact(members <= 256, "Too many reflected members");
      for (uint32_t j = 0; j < members; ++j) {
        Member member; member.name = reader.text(); member.offset = reader.word(); member.size = reader.word(); member.used = reader.word();
        member.scalar = reader.word(); member.rows = reader.word(); member.columns = reader.word(); member.elements = reader.word(); member.row_major = reader.word();
        value.members.push_back(member);
      }
      buffers.push_back(std::move(value));
    }
    count = reader.word(); exact(count <= 32, "Too many oracle textures");
    std::vector<TextureInput> textures;
    for (uint32_t i = 0; i < count; ++i) {
      TextureInput value; value.name = reader.text(); value.width = reader.word(); value.height = reader.word(); value.data = reader.blob();
      exact(value.width > 0 && value.height > 0 && value.width <= 8192 && value.height <= 8192 && uint64_t(value.width) * value.height * 4 == value.data.size(), "Invalid oracle texture data");
      textures.push_back(std::move(value));
    }
    count = reader.word(); exact(count <= 32, "Too many oracle samplers");
    std::vector<SamplerInput> samplers;
    for (uint32_t i = 0; i < count; ++i) {
      SamplerInput value; value.name = reader.text(); value.address = reader.word(); value.filter = reader.word();
      exact(value.address <= 3 && value.filter <= 1, "Unknown oracle sampler descriptor"); samplers.push_back(value);
    }
    reader.done();
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    D3D_FEATURE_LEVEL requested = D3D_FEATURE_LEVEL_11_0, actual;
    check(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, &requested, 1, D3D11_SDK_VERSION, &device, &actual, &context), "D3D11CreateDevice WARP");
    exact(actual == requested, "Unexpected D3D feature level");
    ComPtr<ID3D11VertexShader> vertex_shader;
    ComPtr<ID3D11PixelShader> pixel_shader;
    check(device->CreateVertexShader(vs_bytes.data(), vs_bytes.size(), nullptr, &vertex_shader), "Create original vertex shader");
    check(device->CreatePixelShader(ps_bytes.data(), ps_bytes.size(), nullptr, &pixel_shader), "Create original pixel shader");
    context->VSSetShader(vertex_shader.Get(), nullptr, 0);
    context->PSSetShader(pixel_shader.Get(), nullptr, 0);
    D3D11_INPUT_ELEMENT_DESC layout[] = {
      {"POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"COLOR", 0, DXGI_FORMAT_R8G8B8A8_UNORM, 0, 12, D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"TEXCOORD", 0, DXGI_FORMAT_R16G16B16A16_FLOAT, 0, 16, D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"TEXCOORD", 1, DXGI_FORMAT_R16G16_FLOAT, 0, 24, D3D11_INPUT_PER_VERTEX_DATA, 0},
    };
    ComPtr<ID3D11InputLayout> input_layout;
    check(device->CreateInputLayout(layout, 4, vs_bytes.data(), vs_bytes.size(), &input_layout), "Create native 28-byte input layout");
    context->IASetInputLayout(input_layout.Get());
    std::vector<ComPtr<ID3D11Buffer>> owned_buffers;
    auto buffer = [&](const Bytes& data, UINT bind) {
      D3D11_BUFFER_DESC desc{}; desc.ByteWidth = static_cast<UINT>(data.size()); desc.Usage = D3D11_USAGE_IMMUTABLE; desc.BindFlags = bind;
      D3D11_SUBRESOURCE_DATA initial{}; initial.pSysMem = data.data();
      ComPtr<ID3D11Buffer> result; check(device->CreateBuffer(&desc, &initial, &result), "Create immutable input buffer");
      owned_buffers.push_back(result); return result;
    };
    auto vertex_buffer = buffer(vertices, D3D11_BIND_VERTEX_BUFFER), index_buffer = buffer(indices, D3D11_BIND_INDEX_BUFFER);
    ID3D11Buffer* vb = vertex_buffer.Get(); UINT stride = 28, offset = 0;
    context->IASetVertexBuffers(0, 1, &vb, &stride, &offset);
    context->IASetIndexBuffer(index_buffer.Get(), DXGI_FORMAT_R16_UINT, 0);
    context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    std::map<std::string, ComPtr<ID3D11ShaderResourceView>> resource_views;
    std::vector<ComPtr<ID3D11Texture2D>> owned_textures;
    for (const auto& input : textures) {
      exact(!resource_views.contains(input.name), "Duplicate oracle texture name");
      D3D11_TEXTURE2D_DESC desc{}; desc.Width = input.width; desc.Height = input.height; desc.MipLevels = 1; desc.ArraySize = 1;
      desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM; desc.SampleDesc.Count = 1; desc.Usage = D3D11_USAGE_IMMUTABLE; desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
      D3D11_SUBRESOURCE_DATA initial{}; initial.pSysMem = input.data.data(); initial.SysMemPitch = input.width * 4;
      ComPtr<ID3D11Texture2D> texture; check(device->CreateTexture2D(&desc, &initial, &texture), "Create exact RGBA8 texture");
      ComPtr<ID3D11ShaderResourceView> view; check(device->CreateShaderResourceView(texture.Get(), nullptr, &view), "Create texture view");
      owned_textures.push_back(texture); resource_views.emplace(input.name, view);
    }
    std::map<std::string, ComPtr<ID3D11SamplerState>> sampler_states;
    for (const auto& input : samplers) {
      exact(!sampler_states.contains(input.name), "Duplicate oracle sampler name");
      D3D11_SAMPLER_DESC desc{};
      desc.Filter = input.filter ? D3D11_FILTER_MIN_MAG_MIP_LINEAR : D3D11_FILTER_MIN_MAG_MIP_POINT;
      const D3D11_TEXTURE_ADDRESS_MODE modes[] = {D3D11_TEXTURE_ADDRESS_WRAP, D3D11_TEXTURE_ADDRESS_CLAMP, D3D11_TEXTURE_ADDRESS_MIRROR, D3D11_TEXTURE_ADDRESS_BORDER};
      desc.AddressU = desc.AddressV = desc.AddressW = modes[input.address]; desc.MaxAnisotropy = 1; desc.ComparisonFunc = D3D11_COMPARISON_NEVER; desc.MinLOD = 0; desc.MaxLOD = 0;
      ComPtr<ID3D11SamplerState> sampler; check(device->CreateSamplerState(&desc, &sampler), "Create exact sampler"); sampler_states.emplace(input.name, sampler);
    }
    uint32_t reflected_buffers = 0, reflected_members = 0, reflected_textures = 0, reflected_samplers = 0;
    for (uint32_t stage = 0; stage < 2; ++stage) {
      const auto& code = stage ? ps_bytes : vs_bytes;
      ComPtr<ID3D11ShaderReflection> reflection;
      check(D3DReflect(code.data(), code.size(), __uuidof(ID3D11ShaderReflection), reinterpret_cast<void**>(reflection.GetAddressOf())), "Reflect original DXBC");
      D3D11_SHADER_DESC shader_desc{}; check(reflection->GetDesc(&shader_desc), "Read native shader reflection");
      for (UINT i = 0; i < shader_desc.BoundResources; ++i) {
        D3D11_SHADER_INPUT_BIND_DESC binding{}; check(reflection->GetResourceBindingDesc(i, &binding), "Read native binding slot");
        exact(binding.BindCount == 1, "Resource arrays are not implemented in the oracle");
        if (binding.Type == D3D_SIT_CBUFFER) {
          auto found = std::find_if(buffers.begin(), buffers.end(), [&](const auto& input) { return input.stage == stage && input.name == binding.Name; });
          exact(found != buffers.end(), "Missing native constant-buffer input");
          auto constant = reflection->GetConstantBufferByName(binding.Name);
          D3D11_SHADER_BUFFER_DESC desc{}; check(constant->GetDesc(&desc), "Read native constant-buffer layout");
          exact(desc.Size == found->data.size() && desc.Variables == found->members.size(), "Native/translated constant-buffer size or member-count mismatch");
          for (const auto& member : found->members) {
            auto variable = constant->GetVariableByName(member.name.c_str());
            D3D11_SHADER_VARIABLE_DESC variable_desc{}; check(variable->GetDesc(&variable_desc), "Reflect native member");
            D3D11_SHADER_TYPE_DESC type{}; check(variable->GetType()->GetDesc(&type), "Reflect native member type");
            exact(variable_desc.StartOffset == member.offset && variable_desc.Size == member.size && bool(variable_desc.uFlags & D3D_SVF_USED) == bool(member.used), "Native/translated member layout mismatch");
            exact(static_cast<uint32_t>(type.Type) == member.scalar && type.Rows == member.rows && type.Columns == member.columns && type.Elements == member.elements, "Native/translated member scalar/shape mismatch");
            if (type.Rows > 1) exact((type.Class == D3D_SVC_MATRIX_ROWS) == bool(member.row_major), "Native/translated matrix convention mismatch");
            ++reflected_members;
          }
          auto created = buffer(found->data, D3D11_BIND_CONSTANT_BUFFER); ID3D11Buffer* value = created.Get();
          if (stage) context->PSSetConstantBuffers(binding.BindPoint, 1, &value); else context->VSSetConstantBuffers(binding.BindPoint, 1, &value);
          ++reflected_buffers;
        } else if (binding.Type == D3D_SIT_TEXTURE) {
          exact(binding.Dimension == D3D_SRV_DIMENSION_TEXTURE2D && resource_views.contains(binding.Name), "Missing or unimplemented native texture input");
          ID3D11ShaderResourceView* value = resource_views.at(binding.Name).Get();
          if (stage) context->PSSetShaderResources(binding.BindPoint, 1, &value); else context->VSSetShaderResources(binding.BindPoint, 1, &value);
          ++reflected_textures;
        } else if (binding.Type == D3D_SIT_SAMPLER) {
          if (!sampler_states.contains(binding.Name)) throw std::runtime_error(std::string("Missing native sampler input: ") + binding.Name);
          ID3D11SamplerState* value = sampler_states.at(binding.Name).Get();
          if (stage) context->PSSetSamplers(binding.BindPoint, 1, &value); else context->VSSetSamplers(binding.BindPoint, 1, &value);
          ++reflected_samplers;
        } else throw std::runtime_error("Unimplemented original shader resource kind");
      }
    }
    D3D11_TEXTURE2D_DESC target_desc{}; target_desc.Width = width; target_desc.Height = height; target_desc.MipLevels = 1; target_desc.ArraySize = 1;
    target_desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM; target_desc.SampleDesc.Count = 1; target_desc.Usage = D3D11_USAGE_DEFAULT; target_desc.BindFlags = D3D11_BIND_RENDER_TARGET;
    ComPtr<ID3D11Texture2D> target; check(device->CreateTexture2D(&target_desc, nullptr, &target), "Create offscreen render target");
    ComPtr<ID3D11RenderTargetView> target_view; check(device->CreateRenderTargetView(target.Get(), nullptr, &target_view), "Create offscreen render-target view");
    ID3D11RenderTargetView* rt = target_view.Get(); context->OMSetRenderTargets(1, &rt, nullptr);
    D3D11_BLEND_DESC blend_desc{}; auto& blend = blend_desc.RenderTarget[0]; blend.BlendEnable = TRUE;
    blend.SrcBlend = blend.SrcBlendAlpha = static_cast<D3D11_BLEND>(src); blend.DestBlend = blend.DestBlendAlpha = static_cast<D3D11_BLEND>(dst);
    blend.BlendOp = blend.BlendOpAlpha = D3D11_BLEND_OP_ADD; blend.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    ComPtr<ID3D11BlendState> blend_state; check(device->CreateBlendState(&blend_desc, &blend_state), "Create supplied blend state"); context->OMSetBlendState(blend_state.Get(), nullptr, 0xffffffff);
    D3D11_DEPTH_STENCIL_DESC depth_desc{}; depth_desc.DepthEnable = FALSE; depth_desc.DepthWriteMask = D3D11_DEPTH_WRITE_MASK_ZERO; depth_desc.DepthFunc = D3D11_COMPARISON_ALWAYS;
    ComPtr<ID3D11DepthStencilState> depth; check(device->CreateDepthStencilState(&depth_desc, &depth), "Create supplied depth state"); context->OMSetDepthStencilState(depth.Get(), 0);
    D3D11_RASTERIZER_DESC raster_desc{}; raster_desc.FillMode = D3D11_FILL_SOLID; raster_desc.CullMode = D3D11_CULL_NONE; raster_desc.DepthClipEnable = TRUE;
    ComPtr<ID3D11RasterizerState> raster; check(device->CreateRasterizerState(&raster_desc, &raster), "Create supplied raster state"); context->RSSetState(raster.Get());
    D3D11_VIEWPORT viewport{0, 0, static_cast<float>(width), static_cast<float>(height), 0, 1}; context->RSSetViewports(1, &viewport);
    const float clear[] = {.025f, .035f, .055f, 1.f}; context->ClearRenderTargetView(target_view.Get(), clear);
    context->DrawIndexed(static_cast<UINT>(indices.size() / 2), 0, 0);
    D3D11_TEXTURE2D_DESC staging_desc = target_desc; staging_desc.BindFlags = 0; staging_desc.Usage = D3D11_USAGE_STAGING; staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    ComPtr<ID3D11Texture2D> staging; check(device->CreateTexture2D(&staging_desc, nullptr, &staging), "Create readback texture"); context->CopyResource(staging.Get(), target.Get());
    D3D11_MAPPED_SUBRESOURCE mapped{}; check(context->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped), "Read original shader pixels");
    std::ofstream output(argv[2], std::ios::binary); exact(bool(output), "Cannot create oracle pixel output");
    for (UINT y = 0; y < height; ++y) output.write(static_cast<const char*>(mapped.pData) + size_t(y) * mapped.RowPitch, size_t(width) * 4);
    context->Unmap(staging.Get(), 0); exact(bool(output), "Failed to write oracle pixels"); check(device->GetDeviceRemovedReason(), "D3D device completion");
    // Optional pre-rasterization capture. The original VS runs over each input
    // once as points, with its unchanged resources and constant buffers. The SO
    // object uses only its original output signature, not another shader body.
    std::string vertex_report;
    if (argc == 5) {
      ComPtr<ID3D11ShaderReflection> reflection;
      check(D3DReflect(vs_bytes.data(), vs_bytes.size(), __uuidof(ID3D11ShaderReflection), reinterpret_cast<void**>(reflection.GetAddressOf())), "Reflect original vertex outputs");
      D3D11_SHADER_DESC desc{}; check(reflection->GetDesc(&desc), "Read native output signature");
      std::vector<D3D11_SIGNATURE_PARAMETER_DESC> parameters(desc.OutputParameters);
      std::vector<D3D11_SO_DECLARATION_ENTRY> declarations;
      UINT capture_stride = 0;
      vertex_report = ",\"vertexOutputs\":[";
      for (UINT i = 0; i < desc.OutputParameters; ++i) {
        auto& parameter = parameters[i];
        check(reflection->GetOutputParameterDesc(i, &parameter), "Read native vertex output");
        exact(parameter.ComponentType == D3D_REGISTER_COMPONENT_FLOAT32 && parameter.Mask > 0 && parameter.Mask <= 15 && parameter.Stream == 0, "Unimplemented native vertex output shape");
        BYTE first = 0, components = 0;
        while (!(parameter.Mask & (1 << first))) ++first;
        while (first + components < 4 && (parameter.Mask & (1 << (first + components)))) ++components;
        exact(parameter.Mask == ((1 << components) - 1) << first, "Noncontiguous vertex output mask is not implemented");
        // Signature masks describe packed register lanes. SO declarations use
        // components within the named semantic, whose first component is zero.
        declarations.push_back({0, parameter.SemanticName, parameter.SemanticIndex, 0, components, 0});
        if (i) vertex_report += ",";
        vertex_report += "{\"semantic\":\"" + std::string(parameter.SemanticName) + "\",\"index\":" + std::to_string(parameter.SemanticIndex) + ",\"firstComponent\":0,\"registerFirstComponent\":" + std::to_string(first) + ",\"components\":" + std::to_string(components) + ",\"offset\":" + std::to_string(capture_stride) + "}";
        capture_stride += components * 4;
      }
      exact(capture_stride > 0 && capture_stride <= 256, "Invalid vertex capture stride");
      const UINT vertex_count = static_cast<UINT>(vertices.size() / 28);
      vertex_report += "],\"vertexStride\":" + std::to_string(capture_stride) + ",\"vertexCount\":" + std::to_string(vertex_count);
      ComPtr<ID3D11GeometryShader> stream_shader;
      const HRESULT stream_status = device->CreateGeometryShaderWithStreamOutput(vs_bytes.data(), vs_bytes.size(), declarations.data(), static_cast<UINT>(declarations.size()), &capture_stride, 1, D3D11_SO_NO_RASTERIZED_STREAM, nullptr, &stream_shader);
      if (FAILED(stream_status)) throw std::runtime_error("Original VS stream-output signature rejected: " + vertex_report + " HRESULT " + std::to_string(static_cast<uint32_t>(stream_status)));
      D3D11_BUFFER_DESC capture_desc{}; capture_desc.ByteWidth = capture_stride * vertex_count; capture_desc.Usage = D3D11_USAGE_DEFAULT; capture_desc.BindFlags = D3D11_BIND_STREAM_OUTPUT;
      ComPtr<ID3D11Buffer> capture; check(device->CreateBuffer(&capture_desc, nullptr, &capture), "Create vertex stream-output buffer");
      ID3D11Buffer* stream = capture.Get(); UINT start = 0;
      context->SOSetTargets(1, &stream, &start);
      context->GSSetShader(stream_shader.Get(), nullptr, 0);
      context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_POINTLIST);
      context->Draw(vertex_count, 0);
      context->SOSetTargets(0, nullptr, nullptr); context->GSSetShader(nullptr, nullptr, 0);
      capture_desc.BindFlags = 0; capture_desc.Usage = D3D11_USAGE_STAGING; capture_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
      ComPtr<ID3D11Buffer> capture_staging; check(device->CreateBuffer(&capture_desc, nullptr, &capture_staging), "Create vertex readback buffer");
      context->CopyResource(capture_staging.Get(), capture.Get());
      D3D11_MAPPED_SUBRESOURCE captured{}; check(context->Map(capture_staging.Get(), 0, D3D11_MAP_READ, 0, &captured), "Read original VS outputs");
      std::ofstream vertex_output(argv[4], std::ios::binary); exact(bool(vertex_output), "Cannot create vertex capture output");
      vertex_output.write(static_cast<const char*>(captured.pData), capture_desc.ByteWidth);
      context->Unmap(capture_staging.Get(), 0); exact(bool(vertex_output), "Failed to write original VS outputs");
      check(device->GetDeviceRemovedReason(), "D3D vertex capture completion");
    }
    std::ofstream report(argv[3]); exact(bool(report), "Cannot create oracle reflection report");
    report << "{\"schema\":1,\"backend\":\"D3D11 WARP\",\"featureLevel\":45056,\"rowOrder\":\"top-down RGBA8\",\"width\":" << width << ",\"height\":" << height
      << ",\"reflectedBuffers\":" << reflected_buffers << ",\"reflectedMembers\":" << reflected_members << ",\"reflectedTextures\":" << reflected_textures << ",\"reflectedSamplers\":" << reflected_samplers << vertex_report << "}";
    exact(bool(report), "Failed to write oracle reflection report");
    std::cout << "Original DXBC rendered on D3D11 WARP\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
