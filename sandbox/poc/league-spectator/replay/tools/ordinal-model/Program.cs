using System.Buffers.Binary;
using System.Numerics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using LeagueToolkit.Core.Animation;
using LeagueToolkit.Core.Mesh;
using LeagueToolkit.Core.Memory;
using LeagueToolkit.IO.SimpleSkinFile;
using SharpGLTF.Schema2;

const string scoutMasterYiArmorProjection = "--scout-8428-masteryi-9-armor";
if (args.Length != 3 && (args.Length != 4 || args[3] != scoutMasterYiArmorProjection))
    throw new ArgumentException("Expected original prepared actor folder, isolated model.glb, joint-bindings.json, and optional reviewed Scout projection");
string folder = Path.GetFullPath(args[0]), modelFile = Path.GetFullPath(args[1]), bindingFile = Path.GetFullPath(args[2]);
if (modelFile.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || bindingFile.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Ordinal model output must be isolated from original inputs");
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
byte[] rigBytes = File.ReadAllBytes(Path.Combine(folder, "model.skl")), meshBytes = File.ReadAllBytes(Path.Combine(folder, "model.skn"));
const string rangeLocalKsanteMesh = "cecba47bc884d06eb7425c6987a74322d9701059a8fa6815f0e4ac3980dc02e3";
bool usesKsanteRangeLocalIndices = Hash(meshBytes) == rangeLocalKsanteMesh;
byte[] conversionMeshBytes = usesKsanteRangeLocalIndices ? ProjectKsanteIndices(meshBytes) : meshBytes;
using var skin = SkinnedMesh.ReadFromSimpleSkin(new MemoryStream(conversionMeshBytes, false));
var rig = new RigResource(new MemoryStream(rigBytes, false));
int vertexCount=skin.VerticesView.VertexCount;
var sourceIndices=skin.VerticesView.GetAccessor(ElementName.BlendIndex).AsXyzwU8Array();
var sourceWeights=skin.VerticesView.GetAccessor(ElementName.BlendWeight).AsVector4Array();
byte[] indexSnapshot=new byte[vertexCount*4];float[] weightSnapshot=new float[vertexCount*4];
for(int vertex=0;vertex<vertexCount;vertex++){var ids=sourceIndices[vertex];byte[] values={ids.x,ids.y,ids.z,ids.w};for(int lane=0;lane<4;lane++){indexSnapshot[vertex*4+lane]=values[lane];weightSnapshot[vertex*4+lane]=sourceWeights[vertex][lane];}}
if (rig.Joints.Count < 1 || rig.Joints.Count > 4096 || rig.Influences.Count < 1 || rig.Influences.Count > 256) throw new InvalidDataException("Unadmitted original rig/palette size");
var byId = new Dictionary<short, int>();
for (int index = 0; index < rig.Joints.Count; index++) if (!byId.TryAdd(rig.Joints[index].Id, index)) throw new InvalidDataException("Duplicate original rig ID");
if (rig.Influences.Distinct().Count() != rig.Influences.Count || rig.Influences.Any(id => !byId.ContainsKey(id))) throw new InvalidDataException("Unadmitted duplicate or missing original palette joint ID");
var root = ModelRoot.CreateModel();
var scene = root.UseScene("SkinnedMesh");
var meshNode = scene.CreateNode("skinned_mesh");
var nodes = new Node[rig.Joints.Count];
var visiting = new HashSet<int>();
Node Build(int ordinal)
{
    if (nodes[ordinal] is not null) return nodes[ordinal];
    if (!visiting.Add(ordinal)) throw new InvalidDataException("Cyclic original joint hierarchy");
    var joint = rig.Joints[ordinal];
    Node parent;
    if (joint.ParentId == -1) parent = meshNode;
    else if (byId.TryGetValue(joint.ParentId, out int parentIndex)) parent = Build(parentIndex);
    else throw new InvalidDataException("Missing original joint parent ID");
    var node = parent.CreateNode($"scout_joint_{ordinal}").WithLocalTranslation(joint.LocalTranslation).WithLocalScale(joint.LocalScale).WithLocalRotation(joint.LocalRotation);
    visiting.Remove(ordinal);
    return nodes[ordinal] = node;
}
for (int index = 0; index < nodes.Length; index++) Build(index);
var bindings = JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllBytes(Path.Combine(folder,"texture-bindings.json"))) ?? throw new InvalidDataException("Original submesh texture bindings required");
var textures = new List<(string Material, Stream Texture)>();
try
{
    foreach (var range in skin.Ranges) textures.Add((range.Material, File.OpenRead(Path.GetFullPath(Path.Combine(folder,bindings[range.Material])))));
    var type = typeof(SimpleSkinGltfExtensions);
    var materialsMethod = type.GetMethod("CreateGltfMaterials", BindingFlags.NonPublic | BindingFlags.Static) ?? throw new InvalidDataException("Pinned material helper unavailable");
    var geometryMethod = type.GetMethod("CreateGltfMesh", BindingFlags.NonPublic | BindingFlags.Static) ?? throw new InvalidDataException("Pinned geometry helper unavailable");
    var materials = (IReadOnlyDictionary<string,Material>)materialsMethod.Invoke(null,new object[]{root,skin,textures});
    // Raw SKN BlendIndex values index the original influence palette, NOT the
    // complete joint/name array. Keep that palette in its exact source order.
    byte[] identity = Enumerable.Range(0,rig.Influences.Count).Select(value=>(byte)value).ToArray();
    var geometry = (Mesh)geometryMethod.Invoke(null,new object[]{root,skin,identity,materials});
    if (usesKsanteRangeLocalIndices)
        VerifyKsanteIndexProjection(geometry, meshBytes);
    int ignoredZeroWeightIndices = 0, weightedLanes=0, weightBitDifferences=0, baseVertex=0;
    using var sourceMapping=new MemoryStream();using var exportedMapping=new MemoryStream();using var sourceWriter=new BinaryWriter(sourceMapping);using var exportedWriter=new BinaryWriter(exportedMapping);
    for(int primitiveId=0;primitiveId<geometry.Primitives.Count;primitiveId++)
    {
        var primitive=geometry.Primitives[primitiveId];
        if(skin.Ranges[primitiveId].StartVertex!=baseVertex)throw new InvalidDataException("Unadmitted noncontiguous source vertex ranges");
        var indices = primitive.VertexAccessors["JOINTS_0"].AsVector4Array();
        var weights = primitive.VertexAccessors["WEIGHTS_0"].AsVector4Array();
        for (int vertex=0;vertex<indices.Count;vertex++)
        {
            Vector4 jointIndices=indices[vertex], jointWeights=weights[vertex];
            for(int lane=0;lane<4;lane++)
            {
                float index=jointIndices[lane], weight=jointWeights[lane];
                if(!float.IsFinite(index)||index!=MathF.Truncate(index)||!float.IsFinite(weight)||weight<0)throw new InvalidDataException("Invalid original vertex skin data");
                if(weight>0 && (index<0||index>=rig.Influences.Count))throw new InvalidDataException("Weighted source palette index out of bounds");
                int sourceAt=(baseVertex+vertex)*4+lane;float originalWeight=weightSnapshot[sourceAt];
                if(!float.IsFinite(originalWeight)||originalWeight<0||(originalWeight>0)!=(weight>0))throw new InvalidDataException("Geometry conversion changed contributing skin lanes");
                if(BitConverter.SingleToInt32Bits(originalWeight)!=BitConverter.SingleToInt32Bits(weight))weightBitDifferences++;
                if(weight>0){int originalIndex=indexSnapshot[sourceAt];if(originalIndex>=rig.Influences.Count||rig.Influences[originalIndex]!=rig.Influences[(int)index])throw new InvalidDataException("Geometry conversion changed original weighted joint identity");sourceWriter.Write(baseVertex+vertex);sourceWriter.Write(lane);sourceWriter.Write(rig.Influences[originalIndex]);exportedWriter.Write(baseVertex+vertex);exportedWriter.Write(lane);exportedWriter.Write(rig.Influences[(int)index]);weightedLanes++;}
                if(weight==0 && (index<0||index>=rig.Influences.Count)){jointIndices[lane]=0;ignoredZeroWeightIndices++;}
            }
            indices[vertex]=jointIndices;
        }
        baseVertex+=indices.Count;
    }
    if(weightBitDifferences!=0)throw new InvalidDataException("Geometry conversion changed original vertex weight bits");
    if(baseVertex!=vertexCount||Hash(sourceMapping.ToArray())!=Hash(exportedMapping.ToArray()))throw new InvalidDataException("Original vertex joint mapping coverage differs");
    var palette = rig.Influences.Select(id => (nodes[byId[id]],rig.Joints[byId[id]].InverseBindTransform)).ToArray();
    meshNode.WithSkinnedMesh(geometry,palette);
    root.DefaultScene=scene;
    if (args.Length == 4)
        OmitUnusedMasterYiArmorTangents(geometry, skin, meshBytes);
    Directory.CreateDirectory(Path.GetDirectoryName(modelFile)!);
    root.SaveGLB(modelFile);
    var sidecar = new {schema=1,kind="original-rig-ordinal-model-bindings",rigSha256=Hash(rigBytes),meshSha256=Hash(meshBytes),modelSha256=Hash(File.ReadAllBytes(modelFile)),joints=rig.Joints.Select((joint,index)=>new {poseJointIndex=index,rigId=joint.Id,parentRigId=joint.ParentId,originalName=joint.Name,nodeIndex=nodes[index].LogicalIndex,nodeName=nodes[index].Name}),palette=rig.Influences.Select((id,index)=>new {paletteIndex=index,rigId=id,poseJointIndex=byId[id],nodeIndex=nodes[byId[id]].LogicalIndex}),vertexSkinning=new {sourceVertices=vertexCount,weightedLanes,sourcePaletteIndicesSha256=Hash(indexSnapshot),sourceWeightedJointIdsSha256=Hash(sourceMapping.ToArray()),exportedWeightedJointIdsSha256=Hash(exportedMapping.ToArray()),weightBitDifferences},geometryHelpers=new {assemblySha256=Hash(File.ReadAllBytes(type.Assembly.Location)),materialsMethod=materialsMethod.Name,geometryMethod=geometryMethod.Name},ignoredZeroWeightIndices,scope=new {originalJointOrdinalsPreserved=true,originalPaletteOrderPreserved=true,nativeNameHashLookupUnchanged=true,nativeRendererAdmitted=false}};
    Directory.CreateDirectory(Path.GetDirectoryName(bindingFile)!);
    File.WriteAllBytes(bindingFile,JsonSerializer.SerializeToUtf8Bytes(sidecar,new JsonSerializerOptions{WriteIndented=true}));
    Console.WriteLine(JsonSerializer.Serialize(new {model=modelFile,joints=nodes.Length,palette=rig.Influences.Count,duplicates=rig.Joints.Count-rig.Joints.Select(joint=>joint.Name).Distinct().Count(),ignoredZeroWeightIndices}));
}
finally {foreach(var texture in textures)texture.Texture.Dispose();}

byte[] ProjectKsanteIndices(byte[] original)
{
    byte[] projected = (byte[])original.Clone();
    foreach (var (startVertex, vertexCount, firstIndex, indexCount) in KsanteIndexRanges(original))
    {
        for (int index = firstIndex; index < firstIndex + indexCount; index++)
        {
            var slot = projected.AsSpan(952 + index * sizeof(ushort), sizeof(ushort));
            int local = BinaryPrimitives.ReadUInt16LittleEndian(slot);
            if (local >= vertexCount) throw new InvalidDataException("K'Sante index exceeds its authored range");
            BinaryPrimitives.WriteUInt16LittleEndian(slot, checked((ushort)(startVertex + local)));
        }
    }
    return projected;
}

void VerifyKsanteIndexProjection(Mesh geometry, byte[] original)
{
    var ranges = KsanteIndexRanges(original).ToArray();
    if (geometry.Primitives.Count != ranges.Length) throw new InvalidDataException("K'Sante primitive coverage differs");
    for (int primitive = 0; primitive < ranges.Length; primitive++)
    {
        var (_, vertexCount, firstIndex, indexCount) = ranges[primitive];
        var indices = geometry.Primitives[primitive].GetIndices().ToArray();
        if (indices.Length != indexCount || geometry.Primitives[primitive].VertexAccessors["POSITION"].Count != vertexCount)
            throw new InvalidDataException("K'Sante primitive size differs");
        for (int index = 0; index < indices.Length; index++)
        {
            int originalIndex = BinaryPrimitives.ReadUInt16LittleEndian(original.AsSpan(952 + (firstIndex + index) * sizeof(ushort), sizeof(ushort)));
            if (indices[index] != originalIndex) throw new InvalidDataException("K'Sante GLB index differs from authored range-local topology");
        }
    }
}

IEnumerable<(int StartVertex, int VertexCount, int FirstIndex, int IndexCount)> KsanteIndexRanges(byte[] original)
{
    // This exact SKN stores indices relative to each vertex range. LeagueToolkit
    // takes whole-mesh indices and subtracts StartVertex when emitting a GLB primitive.
    for (int range = 0; range < 11; range++)
    {
        int table = 12 + 80 * range + 64;
        yield return (
            BinaryPrimitives.ReadInt32LittleEndian(original.AsSpan(table)),
            BinaryPrimitives.ReadInt32LittleEndian(original.AsSpan(table + 4)),
            BinaryPrimitives.ReadInt32LittleEndian(original.AsSpan(table + 8)),
            BinaryPrimitives.ReadInt32LittleEndian(original.AsSpan(table + 12)));
    }
}

void OmitUnusedMasterYiArmorTangents(Mesh geometry, SkinnedMesh skin, byte[] meshBytes)
{
    if (Hash(meshBytes) != "3a58c40f9be01bb9de0f9d022a94b35f54eed669ea8100916e526b02b5579b0d" ||
        skin.VerticesView.VertexCount != 19100 ||
        skin.Ranges[0].Material != "Armor" || skin.Ranges[0].StartVertex != 0)
        throw new InvalidDataException("Scout projection requires the reviewed Master Yi Armor mesh");

    var armor = geometry.Primitives[0];
    if (armor.Material.Name != "Armor" ||
        !armor.Material.Channels.Where(channel => channel.Texture != null)
            .Select(channel => channel.Key).SequenceEqual(new[] { "BaseColor" }))
        throw new InvalidDataException("Scout projection requires the base-color Armor material");

    var source = skin.VerticesView.GetAccessor(ElementName.Tangent).AsVector4Array();
    var exported = armor.VertexAccessors["TANGENT"].AsVector4Array();
    int[] expectedZeroVertices = { 1683, 1687, 4599 };
    var zeroVertices = Enumerable.Range(0, exported.Count)
        .Where(i => exported[i].X == 0 && exported[i].Y == 0 && exported[i].Z == 0);
    if (!zeroVertices.SequenceEqual(expectedZeroVertices) ||
        expectedZeroVertices.Any(i => source[i] != exported[i]) ||
        exported[1683].W != -1 || exported[1687].W != -1 || exported[4599].W != 1)
        throw new InvalidDataException("Master Yi Armor tangent projection differs from the reviewed SKN");

    // Scout's native-terrain-actors.mjs reads position, UV, joints, weights and
    // indices for its base-color shader. The three authored zero directions
    // cannot be represented as unit glTF tangents. Strict GLB validation stays on.
    var retained = armor.VertexAccessors.Where(entry => entry.Key != "TANGENT").ToArray();
    var indices = armor.IndexAccessor;
    armor.SetVertexAccessor("TANGENT", null);
    if (!retained.SequenceEqual(armor.VertexAccessors) || armor.IndexAccessor != indices)
        throw new InvalidDataException("Scout projection changed retained Armor accessors");
}
