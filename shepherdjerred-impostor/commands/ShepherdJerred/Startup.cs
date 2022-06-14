using Impostor.Api.Events;
using Impostor.Api.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Commands.ShepherdJerred {
    public class Startup : IPluginStartup {
        public void ConfigureHost(IHostBuilder host) {
        }

        public void ConfigureServices(IServiceCollection services) {
            services.AddSingleton<IEventListener, CommandListener>();
        }
    }
}