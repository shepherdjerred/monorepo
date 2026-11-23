using System.Numerics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using LeagueToolkit.Core.Animation;
using LeagueToolkit.Core.Mesh;
using LeagueToolkit.Core.Memory;
using LeagueToolkit.IO.SimpleSkinFile;
using SharpGLTF.Schema2;

if (args.Length != 3) throw new ArgumentException("Expected original prepared actor folder, isolated model.glb, joint-bindings.json");
string folder = Path.GetFullPath(args[0]), modelFile = Path.GetFullPath(args[1]), bindingFile = Path.GetFullPath(args[2]);
if (modelFile.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || bindingFile.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Ordinal model output must be isolated from original inputs");
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
byte[] rigBytes = File.ReadAllBytes(Path.Combine(folder, "model.skl")), meshBytes = File.ReadAllBytes(Path.Combine(folder, "model.skn"));
using var skin = SkinnedMesh.ReadFromSimpleSkin(new MemoryStream(meshBytes, false));
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
    Directory.CreateDirectory(Path.GetDirectoryName(modelFile)!);
    root.SaveGLB(modelFile);
    var sidecar = new {schema=1,kind="original-rig-ordinal-model-bindings",rigSha256=Hash(rigBytes),meshSha256=Hash(meshBytes),modelSha256=Hash(File.ReadAllBytes(modelFile)),joints=rig.Joints.Select((joint,index)=>new {poseJointIndex=index,rigId=joint.Id,parentRigId=joint.ParentId,originalName=joint.Name,nodeIndex=nodes[index].LogicalIndex,nodeName=nodes[index].Name}),palette=rig.Influences.Select((id,index)=>new {paletteIndex=index,rigId=id,poseJointIndex=byId[id],nodeIndex=nodes[byId[id]].LogicalIndex}),vertexSkinning=new {sourceVertices=vertexCount,weightedLanes,sourcePaletteIndicesSha256=Hash(indexSnapshot),sourceWeightedJointIdsSha256=Hash(sourceMapping.ToArray()),exportedWeightedJointIdsSha256=Hash(exportedMapping.ToArray()),weightBitDifferences},geometryHelpers=new {assemblySha256=Hash(File.ReadAllBytes(type.Assembly.Location)),materialsMethod=materialsMethod.Name,geometryMethod=geometryMethod.Name},ignoredZeroWeightIndices,scope=new {originalJointOrdinalsPreserved=true,originalPaletteOrderPreserved=true,nativeNameHashLookupUnchanged=true,nativeRendererAdmitted=false}};
    Directory.CreateDirectory(Path.GetDirectoryName(bindingFile)!);
    File.WriteAllBytes(bindingFile,JsonSerializer.SerializeToUtf8Bytes(sidecar,new JsonSerializerOptions{WriteIndented=true}));
    Console.WriteLine(JsonSerializer.Serialize(new {model=modelFile,joints=nodes.Length,palette=rig.Influences.Count,duplicates=rig.Joints.Count-rig.Joints.Select(joint=>joint.Name).Distinct().Count(),ignoredZeroWeightIndices}));
}
finally {foreach(var texture in textures)texture.Texture.Dispose();}
