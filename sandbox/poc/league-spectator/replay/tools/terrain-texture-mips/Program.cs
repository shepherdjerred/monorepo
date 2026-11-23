using System.Runtime.InteropServices;
using System.Text.Json;
using LeagueToolkit.Core.Renderer;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

const int maxSide = 512;
var jobs = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(args.Single()))
    ?? throw new InvalidDataException("Texture job list is missing");
var results = new Dictionary<string, object>();
foreach (var (inputPath, outputPath) in jobs)
{
    using var input = File.OpenRead(inputPath);
    var texture = Texture.Load(input);
    int index = Array.FindIndex(texture.Mips, mip => mip.Width <= maxSide && mip.Height <= maxSide);
    if (index < 0)
        throw new InvalidDataException("No authored mip fits the preview texture limit");
    var mip = texture.Mips[index];
    var pixels = new byte[checked(mip.Width * mip.Height * 4)];
    for (int row = 0; row < mip.Height; row++)
        MemoryMarshal.AsBytes(mip.Span.GetRowSpan(row)).CopyTo(pixels.AsSpan(row * mip.Width * 4, mip.Width * 4));
    using var image = Image.LoadPixelData<Rgba32>(pixels, mip.Width, mip.Height);
    image.SaveAsPng(outputPath);
    results.Add(inputPath, new { mipLevel = index, width = mip.Width, height = mip.Height });
}
Console.WriteLine(JsonSerializer.Serialize(results));
