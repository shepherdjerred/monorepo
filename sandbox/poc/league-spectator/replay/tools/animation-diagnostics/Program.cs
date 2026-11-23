using System.Numerics;
using System.Security.Cryptography;
using System.Text.Json;
using LeagueToolkit.Core.Animation;
using LeagueToolkit.Core.Mesh;
using LeagueToolkit.Hashing;

if (args.Length < 2 || args.Skip(2).Any(argument => argument != "--owned-compressed" && !argument.StartsWith("--native-controls="))) throw new ArgumentException("Expected original actor folder and diagnostic output [--owned-compressed] [--native-controls=file]");
bool ownedCompressed = args.Contains("--owned-compressed");
string controlsFile = args.Skip(2).FirstOrDefault(argument => argument.StartsWith("--native-controls="))?.Split('=', 2)[1];
using var controlsDocument = controlsFile is null ? null : JsonDocument.Parse(File.ReadAllBytes(controlsFile));
var nativeComparisons = new List<object>();
string folder = Path.GetFullPath(args[0]);
var selected = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllBytes(Path.Combine(folder, "selected-clips.json")))
    ?? throw new InvalidDataException("Original selected-clip source required");
using var rigInput = File.OpenRead(Path.Combine(folder, "model.skl"));
var rig = new RigResource(rigInput);
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
object Scalar(float value) => new { text = value.ToString("R", System.Globalization.CultureInfo.InvariantCulture), bits = BitConverter.SingleToUInt32Bits(value).ToString("x8") };
var records = new List<object>();
foreach (var group in selected.GroupBy(pair => pair.Value, StringComparer.Ordinal))
{
    string source = Path.GetFullPath(Path.Combine(folder, group.Key));
    if (!source.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("Animation input escaped owned actor folder");
    byte[] original = File.ReadAllBytes(source);
    using var input = new MemoryStream(original, false);
    using IAnimationAsset animation = ownedCompressed && original.AsSpan(0, 8).SequenceEqual("r3d2canm"u8)
        ? new Scout.ArchivedAnimation.CompressedAnimationAsset(input)
        : AnimationAsset.Load(input);
    var failures = new List<object>();
    long nonFiniteComponents = 0;
    int frames = float.IsFinite(animation.Fps) && float.IsFinite(animation.Duration)
        ? (int)(animation.Fps * animation.Duration) : 0;
    if (frames < 1 || frames > 100000 || animation.Fps <= 0)
        throw new InvalidDataException($"Invalid source animation time domain: {group.Key}");
    var first = new Dictionary<uint, (Quaternion Rotation, Vector3 Translation, Vector3 Scale)>();
    animation.Evaluate(0, first);
    var activeJoints = rig.Joints.Where(joint => first.ContainsKey(Elf.HashLower(joint.Name))).ToArray();
    for (int frame = 0; frame < frames; frame++)
    {
        var poses = new Dictionary<uint, (Quaternion Rotation, Vector3 Translation, Vector3 Scale)>();
        animation.Evaluate(frame / animation.Fps, poses);
        foreach (var joint in activeJoints)
        {
            uint hash = Elf.HashLower(joint.Name);
            if (!poses.TryGetValue(hash, out var pose))
                throw new InvalidDataException($"Original animation joint disappeared: {group.Key}/{joint.Name}/{frame}");
            foreach (string channel in new[] { "quaternion", "position", "scale" })
            {
                float[] lanes = channel switch
                {
                    "quaternion" => new[] { pose.Rotation.X, pose.Rotation.Y, pose.Rotation.Z, pose.Rotation.W },
                    "position" => new[] { pose.Translation.X, pose.Translation.Y, pose.Translation.Z },
                    "scale" => new[] { pose.Scale.X, pose.Scale.Y, pose.Scale.Z },
                    _ => throw new InvalidDataException("Unknown animation channel")
                };
                if (lanes.All(float.IsFinite)) continue;
                nonFiniteComponents += lanes.Count(value => !float.IsFinite(value));
                if (failures.Count < 24)
                    failures.Add(new { frame, time = frame / animation.Fps, joint = joint.Name, jointHash = hash, channel, lanes = lanes.Select(Scalar).ToArray() });
            }
        }
    }
    object rewindFailure = null;
    long? rewoundZeroNonFiniteComponents = null;
    try
    {
        var rewind = new Dictionary<uint, (Quaternion Rotation, Vector3 Translation, Vector3 Scale)>();
        animation.Evaluate(0, rewind);
        rewoundZeroNonFiniteComponents = rewind.Values.Sum(pose => new[] { pose.Rotation.X, pose.Rotation.Y, pose.Rotation.Z, pose.Rotation.W, pose.Translation.X, pose.Translation.Y, pose.Translation.Z, pose.Scale.X, pose.Scale.Y, pose.Scale.Z }.Count(value => !float.IsFinite(value)));
    }
    catch (Exception error)
    {
        // This program records failure evidence, never publishes pose assets.
        rewindFailure = new { type = error.GetType().FullName, error.Message };
    }
    records.Add(new { file = group.Key, names = group.Select(pair => pair.Key).ToArray(), sourceSha256 = Hash(original), sourceBytes = original.Length, originalHeaderHex = Convert.ToHexString(original.AsSpan(0, Math.Min(160, original.Length))).ToLowerInvariant(), animationType = animation.GetType().FullName, duration = Scalar(animation.Duration), fps = Scalar(animation.Fps), frames, activeJoints = activeJoints.Length, nonFiniteComponents, rewoundZeroNonFiniteComponents, rewindFailure, firstFailures = failures });
    if (controlsDocument is not null && controlsDocument.RootElement.GetProperty("sourceSha256").GetString() == Hash(original))
    {
        var controls = controlsDocument.RootElement;
        if (controls.GetProperty("boundary").ValueKind != JsonValueKind.Null || controls.GetProperty("rigSha256").GetString() != Hash(File.ReadAllBytes(Path.Combine(folder, "model.skl"))))
            throw new InvalidDataException("Completed matching original native controls required");
        using var controlInput = new MemoryStream(original, false);
        using IAnimationAsset candidate = ownedCompressed && original.AsSpan(0, 8).SequenceEqual("r3d2canm"u8) ? new Scout.ArchivedAnimation.CompressedAnimationAsset(controlInput) : AnimationAsset.Load(controlInput);
        int[] bound = controls.GetProperty("trackIndices").EnumerateArray().Select(value => value.GetInt32()).ToArray();
        long compared = 0, bitMismatches = 0, nonFinite = 0;
        double maximumError = 0;
        var samples = new List<object>();
        object worst = null;
        foreach (var sample in controls.GetProperty("samples").EnumerateArray())
        {
            float time = sample.GetProperty("time").GetSingle();
            byte[] expected = Convert.FromHexString(sample.GetProperty("localPosesHex").GetString()!);
            var pose = new Dictionary<uint, (Quaternion Rotation, Vector3 Translation, Vector3 Scale)>();
            candidate.Evaluate(time, pose);
            long mismatches = 0;
            double error = 0;
            for (int joint = 0; joint < rig.Joints.Count; joint++)
            {
                if (bound[joint] < 0) continue;
                if (!pose.TryGetValue(Elf.HashLower(rig.Joints[joint].Name), out var value)) throw new InvalidDataException("Candidate omitted an originally bound track");
                float[] actual = { value.Translation.X, value.Translation.Y, value.Translation.Z, value.Scale.X, value.Scale.Y, value.Scale.Z, value.Rotation.X, value.Rotation.Y, value.Rotation.Z, value.Rotation.W };
                for (int lane = 0; lane < 10; lane++)
                {
                    float wanted = BitConverter.ToSingle(expected, joint * 40 + lane * 4);
                    compared++;
                    if (!float.IsFinite(actual[lane])) nonFinite++;
                    else
                    {
                        double difference = Math.Abs((double)actual[lane] - wanted);
                        error = Math.Max(error, difference);
                        if (difference > maximumError) worst = new { time, joint, bone = rig.Joints[joint].Name, lane, actual = actual[lane], expected = wanted, cache = candidate is Scout.ArchivedAnimation.CompressedAnimationAsset owned ? owned.InspectJoint(Elf.HashLower(rig.Joints[joint].Name)) : null };
                    }
                    if (BitConverter.SingleToInt32Bits(actual[lane]) != BitConverter.SingleToInt32Bits(wanted)) mismatches++;
                }
            }
            bitMismatches += mismatches;
            maximumError = Math.Max(maximumError, error);
            samples.Add(new { time, bitMismatches = mismatches, maximumComponentError = error });
        }
        nativeComparisons.Add(new { sourceSha256 = Hash(original), controlsSha256 = Hash(File.ReadAllBytes(controlsFile!)), comparedComponents = compared, bitMismatches, nonFiniteComponents = nonFinite, maximumComponentError = maximumError, worst, samples });
    }
}
if (controlsDocument is not null && nativeComparisons.Count != 1) throw new InvalidDataException("Exactly one original native comparison source required");
File.WriteAllBytes(args[1], JsonSerializer.SerializeToUtf8Bytes(new { schema = 1, scope = "Source-bound converter diagnostics; native comparison metrics establish only the measured inputs", rigSha256 = Hash(File.ReadAllBytes(Path.Combine(folder, "model.skl"))), rigJoints = rig.Joints.Select(joint => joint.Name).ToArray(), selectedSha256 = Hash(File.ReadAllBytes(Path.Combine(folder, "selected-clips.json"))), records, nativeComparisons }, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Inspected {records.Count} original animation resources without changing any source assets");
