using System.Numerics;
using System.Text.Json;
using LeagueToolkit.Core.Environment;
using LeagueToolkit.Core.Memory;
using LeagueToolkit.Core.Animation;
using LeagueToolkit.Core.Mesh;
using LeagueToolkit.IO.SimpleSkinFile;
using SixLabors.ImageSharp;
using LeagueToolkit.Toolkit;
using LeagueToolkit.Hashing;
using System.Text;
var mode=args[0];args=args[1..];
if(mode=="textures"){
var jobs=JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(args[0]))!;
foreach(var job in jobs){
 using var input=File.OpenRead(job.Key);
 var texture=LeagueToolkit.Core.Renderer.Texture.Load(input);
 using var image=texture.Mips[0].ToImage();
 image.SaveAsPng(job.Value);
}
Console.WriteLine($"Converted {jobs.Count} exact-build textures");
}else if(mode=="map"){

using var asset = new EnvironmentAsset(File.OpenRead(args[0]));
Directory.CreateDirectory(args[1]);
using var writer = new BinaryWriter(File.Create(Path.Combine(args[1], "map.bin")));
var meshes = new List<object>();
foreach (var mesh in asset.Meshes) {
 if (((int)mesh.VisibilityFlags & 1) == 0) continue;
 var positions = mesh.VerticesView.GetAccessor(ElementName.Position).AsVector3Array();
 long positionOffset = writer.BaseStream.Position;
 foreach (var p in positions) {var v=Vector3.Transform(p, mesh.Transform);writer.Write(v.X);writer.Write(v.Y);writer.Write(v.Z);}
 long uvOffset = writer.BaseStream.Position;
 bool hasUv = mesh.VerticesView.TryGetAccessor(ElementName.Texcoord0, out var uvAccessor);
 if (hasUv) foreach (var v in uvAccessor.AsVector2Array()){writer.Write(v.X);writer.Write(v.Y);}
 long uv1Offset = writer.BaseStream.Position;
 bool hasUv1 = mesh.VerticesView.TryGetAccessor(ElementName.Texcoord1, out var uv1Accessor);
 if (hasUv1) foreach (var v in uv1Accessor.AsVector2Array()){writer.Write(v.X);writer.Write(v.Y);}
 long indexOffset = writer.BaseStream.Position;
 foreach (var i in mesh.Indices) writer.Write((uint)i);
 meshes.Add(new {positionOffset,uvOffset,uv1Offset,indexOffset,vertexCount=positions.Count,indexCount=mesh.Indices.Count,hasUv,hasUv1,
  submeshes=mesh.Submeshes.Select(s=>new {material=s.Material,start=s.StartIndex,count=s.IndexCount}),
  bakedLight=mesh.BakedLight.Texture,stationaryLight=mesh.StationaryLight.Texture,
  bakedScale=new[]{mesh.BakedLight.Scale.X,mesh.BakedLight.Scale.Y},bakedBias=new[]{mesh.BakedLight.Bias.X,mesh.BakedLight.Bias.Y},
  flags=(int)mesh.VisibilityFlags,controller=mesh.VisibilityControllerPathHash});
}
File.WriteAllText(Path.Combine(args[1],"map.json"),JsonSerializer.Serialize(new {meshes,source=Path.GetFileName(args[0]),sourceMeshCount=asset.Meshes.Count}));
Console.WriteLine($"Exported {meshes.Count} / {asset.Meshes.Count} meshes, {writer.BaseStream.Position} bytes");
}else if(mode=="effect-mesh"){
using var input=File.OpenRead(args[0]);
var mesh=args[0].EndsWith(".sco",StringComparison.OrdinalIgnoreCase)?StaticMesh.ReadAscii(input):StaticMesh.ReadBinary(input);
var positions=new List<float>();var uv=new List<float>();
foreach(var face in mesh.Faces){
 foreach(var id in new[]{face.VertexId0,face.VertexId1,face.VertexId2}){var p=mesh.Vertices[id];positions.AddRange(new[]{p.X,p.Y,p.Z});}
 foreach(var p in new[]{face.UV0,face.UV1,face.UV2})uv.AddRange(new[]{p.X,p.Y});
}
File.WriteAllText(args[1],JsonSerializer.Serialize(new{positions,uv}));
}else if(mode=="champion"){
var folder=args[0];
using var skin=SkinnedMesh.ReadFromSimpleSkin(File.OpenRead(Path.Combine(folder,"model.skn")));
var rig=new RigResource(File.OpenRead(Path.Combine(folder,"model.skl")));
var clips=JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(folder,"selected-clips.json")))!;
if(args.Length>1){
 var names=JsonSerializer.Deserialize<string[]>(File.ReadAllText(args[1]))!;
 clips=names.ToDictionary(name=>name,name=>clips[name]);
}
var animations=clips.Select(kv=>(kv.Key,AnimationAsset.Load(File.OpenRead(Path.Combine(folder,kv.Value))))).ToList();
var bindingPath=Path.Combine(folder,"texture-bindings.json");
var bindings=File.Exists(bindingPath)?JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(bindingPath)):null;
var textures=skin.Ranges.Select(r=>(r.Material,(Stream)File.OpenRead(Path.Combine(folder,bindings is null?"texture.png":bindings[r.Material])))).ToList();
var gltf=skin.ToGltf(rig,textures,animations);
gltf.SaveGLB(Path.Combine(folder,"model.glb"));
Console.WriteLine($"Exported {animations.Count} animations: {folder}");

}else if(mode=="animation-pack"){
var folder=args[0];
var rig=new RigResource(File.OpenRead(Path.Combine(folder,"model.skl")));
var selected=JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(folder,"selected-clips.json")))!;
var catalog=new Dictionary<string,object>();var converted=new Dictionary<string,object>();
Directory.CreateDirectory(Path.Combine(folder,"clips"));
foreach(var item in selected){
 if(converted.TryGetValue(item.Value,out var existing)){catalog[item.Key]=existing;continue;}
 using var input=File.OpenRead(Path.Combine(folder,item.Value));var animation=AnimationAsset.Load(input);
 int frames=(int)(animation.Fps*animation.Duration);
 if(frames<1||frames>100000||!float.IsFinite(animation.Fps)||animation.Fps<=0)throw new InvalidDataException("Invalid animation sampling bounds");
 var poses=new Dictionary<uint,(Quaternion Rotation,Vector3 Translation,Vector3 Scale)>[frames];
 for(int f=0;f<frames;f++){poses[f]=new();animation.Evaluate(f/animation.Fps,poses[f]);}
 using var data=new MemoryStream();using var writer=new BinaryWriter(data);
 var tracks=new List<object>();
 for(int jointId=0;jointId<rig.Joints.Count;jointId++){
  var joint=rig.Joints[jointId];uint hash=Elf.HashLower(joint.Name);
  if(!poses[0].ContainsKey(hash))continue;
  if(poses.Any(p=>!p.ContainsKey(hash)))throw new InvalidDataException("Animation joint disappeared during sampling");
  foreach(string channel in new[]{"quaternion","position","scale"}){
   int width=channel=="quaternion"?4:3;var values=new float[frames*width];
   for(int f=0;f<frames;f++){
    var pose=poses[f][hash];var v=channel=="quaternion"?new[]{pose.Rotation.X,pose.Rotation.Y,pose.Rotation.Z,pose.Rotation.W}:channel=="position"?new[]{pose.Translation.X,pose.Translation.Y,pose.Translation.Z}:new[]{pose.Scale.X,pose.Scale.Y,pose.Scale.Z};
    Array.Copy(v,0,values,f*width,width);
   }
   if(values.Any(v=>!float.IsFinite(v)))throw new InvalidDataException("Non-finite animation key");
   bool constant=true;for(int f=1;f<frames&&constant;f++)for(int lane=0;lane<width;lane++)if(values[f*width+lane]!=values[lane])constant=false;
   int count=constant?1:frames;long offset=data.Position;
   for(int i=0;i<count*width;i++)writer.Write(values[i]);
   tracks.Add(new{jointId,bone=joint.Name,channel,width,count,offset});
  }
 }
 var file=$"clips/{converted.Count}.clip";
 var header=JsonSerializer.SerializeToUtf8Bytes(new{schema=1,duration=animation.Duration,fps=animation.Fps,frames,tracks});
 using(var output=new BinaryWriter(File.Create(Path.Combine(folder,file)))){output.Write(header.Length);output.Write(header);output.Write(data.ToArray());}
 var entry=new{file,duration=animation.Duration,fps=animation.Fps,frames};converted[item.Value]=entry;catalog[item.Key]=entry;
 if(animation is IDisposable disposable)disposable.Dispose();
}
File.WriteAllText(Path.Combine(folder,"animation-catalog.json"),JsonSerializer.Serialize(new{schema=1,sampling="LeagueToolkit Evaluate at source FPS; interpolation equivalence unverified",joints=rig.Joints.Select(j=>j.Name).ToArray(),clips=catalog}));
Console.WriteLine($"Prepared {catalog.Count} atomic clip names / {converted.Count} independent animation assets: {folder}");
}else if(mode=="skin-info"){
using var skin=SkinnedMesh.ReadFromSimpleSkin(File.OpenRead(args[0]));
File.WriteAllText(args[1],JsonSerializer.Serialize(skin.Ranges.Select(r=>r.Material).ToArray()));
}else throw new ArgumentException("Expected map, champion, animation-pack, skin-info, effect-mesh, or textures");
