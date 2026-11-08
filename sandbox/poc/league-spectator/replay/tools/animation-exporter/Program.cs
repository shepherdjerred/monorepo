using System.Numerics;
using System.Text.Json;
using LeagueToolkit.Core.Animation;
using LeagueToolkit.Core.Mesh;
using LeagueToolkit.Hashing;

if (args.Length != 1) throw new ArgumentException("Expected a pose preparation job file");
var jobs = JsonSerializer.Deserialize<Job[]>(File.ReadAllBytes(args[0]))
    ?? throw new InvalidDataException("Missing pose jobs");
foreach (var job in jobs)
{
    if (job.Frames < 1 || job.Frames > 100000)
        throw new InvalidDataException("Invalid native resource frame count");
    using var rigInput = File.OpenRead(job.Rig);
    var rig = new RigResource(rigInput);
    using var input = File.OpenRead(job.Source);
    using var animation = AnimationAsset.Load(input);
    if (!float.IsFinite(animation.Fps) || animation.Fps <= 0 ||
        !float.IsFinite(animation.Duration) || animation.Duration <= 0)
        throw new InvalidDataException("Invalid source animation time domain");
    var poses = new Dictionary<uint, (Quaternion Rotation, Vector3 Translation, Vector3 Scale)>[job.Frames];
    for (int frame = 0; frame < job.Frames; frame++)
    {
        poses[frame] = new();
        animation.Evaluate(frame / animation.Fps, poses[frame]);
    }
    using var data = new MemoryStream();
    using var writer = new BinaryWriter(data);
    var tracks = new List<object>();
    for (int jointId = 0; jointId < rig.Joints.Count; jointId++)
    {
        var joint = rig.Joints[jointId];
        uint hash = Elf.HashLower(joint.Name);
        if (!poses[0].ContainsKey(hash)) continue;
        if (poses.Any(pose => !pose.ContainsKey(hash)))
            throw new InvalidDataException("Source animation joint disappeared");
        foreach (string channel in new[] { "quaternion", "position", "scale" })
        {
            int width = channel == "quaternion" ? 4 : 3;
            var values = new float[job.Frames * width];
            for (int frame = 0; frame < job.Frames; frame++)
            {
                var pose = poses[frame][hash];
                float[] lanes = channel switch
                {
                    "quaternion" => new[] { pose.Rotation.X, pose.Rotation.Y, pose.Rotation.Z, pose.Rotation.W },
                    "position" => new[] { pose.Translation.X, pose.Translation.Y, pose.Translation.Z },
                    "scale" => new[] { pose.Scale.X, pose.Scale.Y, pose.Scale.Z },
                    _ => throw new InvalidDataException("Unknown animation channel")
                };
                Array.Copy(lanes, 0, values, frame * width, width);
            }
            if (values.Any(value => !float.IsFinite(value)))
                throw new InvalidDataException("Non-finite source animation key");
            bool constant = true;
            for (int frame = 1; frame < job.Frames && constant; frame++)
                for (int lane = 0; lane < width; lane++)
                    if (values[frame * width + lane] != values[lane]) constant = false;
            int count = constant ? 1 : job.Frames;
            long offset = data.Position;
            for (int i = 0; i < count * width; i++) writer.Write(values[i]);
            tracks.Add(new { jointId, bone = joint.Name, channel, width, count, offset });
        }
    }
    var header = JsonSerializer.SerializeToUtf8Bytes(new
    {
        schema = 1, duration = animation.Duration, fps = animation.Fps,
        frames = job.Frames, tracks
    });
    Directory.CreateDirectory(Path.GetDirectoryName(job.Output)!);
    using var output = new BinaryWriter(File.Create(job.Output));
    output.Write(header.Length);
    output.Write(header);
    output.Write(data.ToArray());
}
Console.WriteLine($"Prepared {jobs.Length} animation assets with native resource frame coverage");

record Job(string Rig, string Source, int Frames, string Output);
