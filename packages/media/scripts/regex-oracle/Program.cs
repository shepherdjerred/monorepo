using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

using var protocolStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("protocol.json")
    ?? throw new InvalidOperationException("Missing canonical protocol");
using var protocol = JsonDocument.Parse(protocolStream);
var execution = protocol.RootElement.GetProperty("x-execution");
var limit = execution.GetProperty("maxInputCharacters").GetInt32();
var input = new char[limit + 1];
var length = Console.In.ReadBlock(input, 0, input.Length);
if (length > limit) throw new InvalidOperationException("Oracle input exceeds limit");
using var document = JsonDocument.Parse(new string(input, 0, length));
ProtocolValidator.Validate(document.RootElement, protocol.RootElement.GetProperty("$defs").GetProperty("request"));
var results = new List<object>();
foreach (var request in document.RootElement.GetProperty("requests").EnumerateArray())
{
    var pattern = request.GetProperty("pattern").GetString()!;
    var value = request.GetProperty("value").GetString()!;
    var result = "unknown";
    try
    {
        result = Regex.IsMatch(value, pattern, RegexOptions.IgnoreCase,
            TimeSpan.FromMilliseconds(execution.GetProperty("matchTimeoutMilliseconds").GetInt32())) ? "match" : "no_match";
    }
    catch (ArgumentException) { }
    catch (RegexMatchTimeoutException) { }
    results.Add(new { pattern, value, result });
}
var output = JsonSerializer.SerializeToElement(new {
    protocolVersion = document.RootElement.GetProperty("protocolVersion").GetInt32(),
    engine = "dotnet-ignorecase", runtimeVersion = Environment.Version.ToString(),
    culture = CultureInfo.CurrentCulture.Name, observations = results
});
ProtocolValidator.Validate(output, protocol.RootElement.GetProperty("$defs").GetProperty("response"));
Console.Write(output.GetRawText());
