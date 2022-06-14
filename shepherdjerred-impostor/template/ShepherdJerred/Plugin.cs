using System.Threading.Tasks;
using Impostor.Api.Plugins;

namespace <<[ .projectName ]>>.ShepherdJerred {
    [ImpostorPlugin(
        "com.shepherdjerred",
        "<<[ .projectName ]>>",
        "Jerred Shepherd",
        "1.0.0")]
    // ReSharper disable once UnusedType.Global
    public class Main : PluginBase {
        public override ValueTask EnableAsync() {
            return default;
        }

        public override ValueTask DisableAsync() {
            return default;
        }
    }
}
