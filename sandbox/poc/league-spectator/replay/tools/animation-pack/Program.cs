using System.Numerics;
using System.Security.Cryptography;
using System.Text.Json;
using LeagueToolkit.Core.Animation;
using LeagueToolkit.Core.Mesh;
using LeagueToolkit.Hashing;

if (args.Length != 3) throw new ArgumentException("Expected source actor folder, isolated clip output and format manifest");
string folder = Path.GetFullPath(args[0]), output = Path.GetFullPath(args[1]);
Directory.CreateDirectory(output);
var selected = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllBytes(Path.Combine(folder, "selected-clips.json"))) ?? throw new InvalidDataException("Original selected clips required");
using var rigInput = File.OpenRead(Path.Combine(folder, "model.skl"));
var rig = new RigResource(rigInput);
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
var resources = new List<object>();
foreach (var group in selected.GroupBy(pair => pair.Value, StringComparer.Ordinal))
{
    string source = Path.GetFullPath(Path.Combine(folder, group.Key));
    if (!source.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Animation source escaped actor folder");
    byte[] bytes = File.ReadAllBytes(source);
    if (bytes.Length < 40) throw new InvalidDataException("Truncated original animation");
    string magic = System.Text.Encoding.ASCII.GetString(bytes, 0, 8);
    uint version = BitConverter.ToUInt32(bytes, 8);
    string file = $"clips/{resources.Count}.clip";
    if (magic == "r3d2canm" && version == 1)
    {
        // A format implementation, not an error-triggered converter retry.
        resources.Add(new { file = group.Key, names = group.Select(pair => pair.Key).ToArray(), sourceSha256 = Hash(bytes), outputFile = file, evaluator = "original-native-compressed-v1", status = "native-export-required" });
        continue;
    }
    if (magic != "r3d2anmd" || version is not (3 or 4 or 5)) throw new InvalidDataException($"Unadmitted animation format {magic}/{version}");
    using var input = new MemoryStream(bytes, false);
    using var animation = AnimationAsset.Load(input);
    int frames = checked((int)BitConverter.ToUInt32(bytes, version == 3 ? 20 : 32));
    if (frames < 1 || frames > 100000 || !float.IsFinite(animation.Fps) || animation.Fps <= 0 || !float.IsFinite(animation.Duration) || animation.Duration < 0) throw new InvalidDataException("Invalid original uncompressed animation time domain");
    if ((long)frames * rig.Joints.Count * 40 > 512L * 1024 * 1024) throw new InvalidDataException("Original animation sample budget exceeded");
    var poses = new Dictionary<uint, (Quaternion Rotation, Vector3 Translation, Vector3 Scale)>[frames];
    for (int frame = 0; frame < frames; frame++)
    {
        poses[frame] = new();
        animation.Evaluate(frame / animation.Fps, poses[frame]);
    }
    using var data = new MemoryStream();
    using var writer = new BinaryWriter(data);
    var tracks = new List<object>();
    for (int joint = 0; joint < rig.Joints.Count; joint++)
    {
        string bone = rig.Joints[joint].Name;
        uint hash = Elf.HashLower(bone);
        if (!poses[0].ContainsKey(hash)) continue;
        if (poses.Any(pose => !pose.ContainsKey(hash))) throw new InvalidDataException("Original uncompressed joint disappeared");
        foreach (string channel in new[] { "position", "scale", "quaternion" })
        {
            int width = channel == "quaternion" ? 4 : 3;
            var values = new float[frames * width];
            for (int frame = 0; frame < frames; frame++)
            {
                var pose = poses[frame][hash];
                float[] lanes = channel == "quaternion" ? new[] { pose.Rotation.X, pose.Rotation.Y, pose.Rotation.Z, pose.Rotation.W } : channel == "position" ? new[] { pose.Translation.X, pose.Translation.Y, pose.Translation.Z } : new[] { pose.Scale.X, pose.Scale.Y, pose.Scale.Z };
                Array.Copy(lanes, 0, values, frame * width, width);
            }
            if (values.Any(value => !float.IsFinite(value))) throw new InvalidDataException("Non-finite uncompressed animation sample");
            bool constant = true;
            for (int frame = 1; frame < frames && constant; frame++) for (int lane = 0; lane < width; lane++) if (BitConverter.SingleToInt32Bits(values[frame * width + lane]) != BitConverter.SingleToInt32Bits(values[lane])) constant = false;
            int count = constant ? 1 : frames;
            long offset = data.Position;
            for (int at = 0; at < count * width; at++) writer.Write(values[at]);
            tracks.Add(new { jointId = joint, bone, channel, width, count, offset });
        }
    }
    byte[] header = JsonSerializer.SerializeToUtf8Bytes(new { schema = 1, duration = animation.Duration, fps = animation.Fps, frames, tracks });
    using (var destination = new BinaryWriter(File.Create(Path.Combine(output, Path.GetFileName(file))))) { destination.Write(header.Length); destination.Write(header); destination.Write(data.ToArray()); }
    resources.Add(new { file = group.Key, names = group.Select(pair => pair.Key).ToArray(), sourceSha256 = Hash(bytes), outputFile = file, evaluator = "pinned-toolkit-uncompressed", status = "prepared", duration = animation.Duration, fps = animation.Fps, frames });
}
File.WriteAllBytes(args[2], JsonSerializer.SerializeToUtf8Bytes(new { schema = 1, rigSha256 = Hash(File.ReadAllBytes(Path.Combine(folder, "model.skl"))), rigJoints = rig.Joints.Select(joint => joint.Name).ToArray(), records = resources }, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Classified {resources.Count} original animation resources; compressed-v1 requires original-native export");
