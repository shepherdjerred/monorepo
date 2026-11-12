import type { Construct } from "constructs";
import { Fn, Op, TerraformLocal, TerraformVariable, Token, ref } from "cdktn";
import { Application } from "#generated/providers/prowlarr/application/index.ts";
import { DownloadClient as ProwlarrDownloadClient } from "#generated/providers/prowlarr/download-client/index.ts";
import { Indexer } from "#generated/providers/prowlarr/indexer/index.ts";
import type { IndexerFields } from "#generated/providers/prowlarr/indexer/index.ts";
import { ProwlarrProvider } from "#generated/providers/prowlarr/provider/index.ts";
import { DownloadClient as RadarrDownloadClient } from "#generated/providers/radarr/download-client/index.ts";
import { RadarrProvider } from "#generated/providers/radarr/provider/index.ts";
import { RootFolder as RadarrRootFolder } from "#generated/providers/radarr/root-folder/index.ts";
import { DownloadClient as SonarrDownloadClient } from "#generated/providers/sonarr/download-client/index.ts";
import { SonarrProvider } from "#generated/providers/sonarr/provider/index.ts";
import { RootFolder as SonarrRootFolder } from "#generated/providers/sonarr/root-folder/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";

/**
 * Per-secret variables (one CI secret / 1Password field each), in the order
 * `local.arr_api_keys` lists them. Each is validated non-empty so a missing
 * or blank secret fails here rather than deep in a provider call.
 */
const SECRETS = [
  {
    key: "radarr",
    variable: "radarr_api_key",
    description:
      "Radarr REST API key (provider auth + Prowlarr application sync).",
  },
  {
    key: "sonarr",
    variable: "sonarr_api_key",
    description:
      "Sonarr REST API key (provider auth + Prowlarr application sync).",
  },
  {
    key: "prowlarr",
    variable: "prowlarr_api_key",
    description: "Prowlarr REST API key (provider auth).",
  },
  {
    key: "qbittorrent",
    variable: "qbittorrent_password",
    description:
      'qBittorrent WebUI password (user "jerred") used by the Radarr/Sonarr/Prowlarr download clients.',
  },
  {
    key: "privatehd_password",
    variable: "privatehd_password",
    description:
      "PrivateHD account password for the Prowlarr PrivateHD indexer.",
  },
  {
    key: "privatehd_pid",
    variable: "privatehd_pid",
    description:
      "PrivateHD PID (AvisTaz per-user token) for the Prowlarr PrivateHD indexer.",
  },
  {
    key: "avistaz_password",
    variable: "avistaz_password",
    description:
      "AvistaZ (avistaz.to) account password for the Prowlarr AvistaZ indexer.",
  },
  {
    key: "avistaz_pid",
    variable: "avistaz_pid",
    description:
      "AvistaZ PID (per-account token from My Account / My Profile) for the Prowlarr AvistaZ indexer.",
  },
  {
    key: "animez_password",
    variable: "animez_password",
    description:
      "AnimeZ (animez.to) account password for the Prowlarr AnimeZ indexer.",
  },
  {
    key: "animez_pid",
    variable: "animez_pid",
    description:
      "AnimeZ PID (per-account token from My Account / My Profile) for the Prowlarr AnimeZ indexer.",
  },
] as const;

type SecretKey = (typeof SECRETS)[number]["key"];

/**
 * `local.arr_api_keys["<key>"]`. The local is built from sensitive
 * variables, so every value read through it stays sensitive. A raw
 * "${local.…}" string would be escaped where it passes through Fn or Op.
 */
function secret(key: SecretKey): string {
  return Token.asString(ref(`local.arr_api_keys["${key}"]`));
}

const bool = (name: string, boolValue: boolean): IndexerFields => ({
  name,
  boolValue,
});
const num = (name: string, numberValue: number): IndexerFields => ({
  name,
  numberValue,
});
const text = (name: string, textValue: string): IndexerFields => ({
  name,
  textValue,
});
const sensitive = (name: string, key: SecretKey): IndexerFields => ({
  name,
  sensitiveValue: secret(key),
});

/**
 * Prowlarr owns and auto-updates its Cardigann indexer definitions, so
 * `fields` drifts by design as definitions evolve. The devopsarr provider
 * also fails any apply that touches fields ("Provider produced inconsistent
 * result after apply: .fields: inconsistent values for sensitive attribute",
 * main build 5039, 2026-07-04). Manage the indexer's lifecycle here (enable,
 * profile, name); leave field contents to the app.
 */
const FIELDS_OWNED_BY_PROWLARR = { ignoreChanges: ["fields"] };

/**
 * Managed *arr config (Radarr / Sonarr / Prowlarr), imported from the live
 * instances and verified zero-change. Sensitive fields the *arr APIs read
 * back as null (unused API keys and tokens) are left unset: Tofu does not
 * re-send them. Quality profiles and custom formats are owned by Recyclarr,
 * not this stack. Radarr/Sonarr indexers are managed by Prowlarr's
 * application sync and are likewise not here.
 */
export class ArrStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "arr", {
      requiredVersion: ">= 1.6.0",
      providerConstraints: {
        radarr: "~> 2.0",
        sonarr: "~> 3.0",
        prowlarr: "~> 3.0",
      },
    });

    const values: Record<string, string> = {};
    for (const { key, variable, description } of SECRETS) {
      const input = new TerraformVariable(this, variable, {
        description,
        type: "string",
        sensitive: true,
      });
      input.addValidation({
        condition: Op.gt(Fn.lengthOf(input.stringValue), 0),
        errorMessage: `${variable} must be non-empty (set ${variable.toUpperCase()} / TF_VAR_${variable}).`,
      });
      values[key] = input.stringValue;
    }
    // Resources index the secrets by slug, so they do not care how each one
    // is transported.
    new TerraformLocal(this, "arr_api_keys", values);

    // The *arr apps are reached over the tailnet, like the state backend.
    // Provider and resource construct ids share one scope, so the providers
    // take ids no resource name uses; a provider's address is its type.
    new RadarrProvider(this, "radarr_provider", {
      url: "https://radarr.tailnet-1a49.ts.net",
      apiKey: secret("radarr"),
    });
    new SonarrProvider(this, "sonarr_provider", {
      url: "https://sonarr.tailnet-1a49.ts.net",
      apiKey: secret("sonarr"),
    });
    new ProwlarrProvider(this, "prowlarr_provider", {
      url: "https://prowlarr.tailnet-1a49.ts.net",
      apiKey: secret("prowlarr"),
    });

    this.addRadarr();
    this.addSonarr();
    this.addProwlarrApplications();
    this.addPublicIndexers();
    this.addAvistazNetworkIndexers();
  }

  private addRadarr(): void {
    new RadarrRootFolder(this, "movies", { path: "/movies" });

    // Three download clients are named `qbittorrent`; construct ids must be
    // unique across resource types, so each keeps its address by override.
    new RadarrDownloadClient(this, "radarr_download_client_qbittorrent", {
      additionalTags: [],
      configContract: "QBittorrentSettings",
      enable: true,
      fieldTags: [],
      firstAndLast: false,
      host: "media-qbittorrent-service",
      implementation: "QBittorrent",
      initialState: 0,
      movieCategory: "radarr",
      name: "qBittorrent",
      olderMoviePriority: 0,
      // qBittorrent WebUI password (user "jerred"), sourced from 1Password
      // so an apply never nulls the download-client credential.
      password: secret("qbittorrent"),
      port: 8080,
      postImportTags: [],
      priority: 1,
      protocol: "torrent",
      recentMoviePriority: 0,
      removeCompletedDownloads: true,
      removeFailedDownloads: true,
      sequentialOrder: false,
      tags: [],
      useSsl: false,
      username: "jerred",
    }).overrideLogicalId("qbittorrent");
  }

  private addSonarr(): void {
    new SonarrDownloadClient(this, "sonarr_download_client_qbittorrent", {
      additionalTags: [],
      configContract: "QBittorrentSettings",
      enable: true,
      fieldTags: [],
      firstAndLast: false,
      host: "media-qbittorrent-service",
      implementation: "QBittorrent",
      initialState: 0,
      name: "qBittorrent",
      olderTvPriority: 0,
      password: secret("qbittorrent"),
      port: 8080,
      postImportTags: [],
      priority: 1,
      protocol: "torrent",
      recentTvPriority: 0,
      removeCompletedDownloads: true,
      removeFailedDownloads: true,
      sequentialOrder: false,
      tags: [],
      tvCategory: "tv-sonarr",
      useSsl: false,
      username: "jerred",
    }).overrideLogicalId("qbittorrent");

    new SonarrRootFolder(this, "tv", { path: "/tv" });
  }

  private addProwlarrApplications(): void {
    // Each application's API key is that app's own REST key, managed so an
    // apply never nulls the sync credential.
    new Application(this, "prowlarr_application_sonarr", {
      animeSyncCategories: [5070],
      apiKey: secret("sonarr"),
      baseUrl: "http://media-sonarr-service:8989",
      configContract: "SonarrSettings",
      implementation: "Sonarr",
      name: "Sonarr",
      prowlarrUrl: "http://media-prowlarr-service:9696",
      syncCategories: [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
      syncLevel: "fullSync",
      tags: [],
    }).overrideLogicalId("sonarr");

    new Application(this, "prowlarr_application_radarr", {
      animeSyncCategories: [],
      apiKey: secret("radarr"),
      baseUrl: "http://media-radarr-service:7878",
      configContract: "RadarrSettings",
      implementation: "Radarr",
      name: "Radarr",
      prowlarrUrl: "http://media-prowlarr-service:9696",
      syncCategories: [
        2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090,
      ],
      syncLevel: "fullSync",
      tags: [],
    }).overrideLogicalId("radarr");

    new ProwlarrDownloadClient(this, "prowlarr_download_client_qbittorrent", {
      additionalTags: [],
      categories: [],
      category: "prowlarr",
      configContract: "QBittorrentSettings",
      enable: true,
      fieldTags: [],
      host: "media-qbittorrent-service",
      implementation: "QBittorrent",
      initialState: 0,
      itemPriority: 0,
      name: "qBittorrent",
      password: secret("qbittorrent"),
      port: 8080,
      postImTags: [],
      priority: 1,
      protocol: "torrent",
      tags: [],
      useSsl: false,
      username: "jerred",
    }).overrideLogicalId("qbittorrent");
  }

  private addPublicIndexers(): void {
    new Indexer(this, "knaben", {
      appProfileId: 1,
      configContract: "NoAuthTorrentBaseSettings",
      enable: true,
      fields: [
        bool("torrentBaseSettings.preferMagnetUrl", false),
        num("baseSettings.limitsUnit", 0),
      ],
      implementation: "Knaben",
      name: "Knaben",
      priority: 25,
      protocol: "torrent",
      tags: [],
      lifecycle: FIELDS_OWNED_BY_PROWLARR,
    });

    new Indexer(this, "magnetdownload", {
      appProfileId: 1,
      configContract: "CardigannSettings",
      enable: true,
      fields: [
        bool("torrentBaseSettings.preferMagnetUrl", false),
        num("baseSettings.limitsUnit", 0),
        text("definitionFile", "magnetdownload"),
        text(
          "info_category_8000",
          "MagnetDownload does not return categories in its search results. To sync to your apps, include 8000(Other) in your Apps' Sync Categories.",
        ),
      ],
      implementation: "Cardigann",
      name: "MagnetDownload",
      priority: 25,
      protocol: "torrent",
      tags: [],
      lifecycle: FIELDS_OWNED_BY_PROWLARR,
    });

    new Indexer(this, "the_pirate_bay", {
      appProfileId: 1,
      configContract: "CardigannSettings",
      enable: true,
      fields: [
        bool("torrentBaseSettings.preferMagnetUrl", false),
        text("apiurl", "apibay.org"),
        num("baseSettings.limitsUnit", 0),
        text("definitionFile", "thepiratebay"),
        text(
          "info_uploader",
          "You can filter by Uploader by entering a Case Sensitive username, or leave empty to get all results.<br>Note: this is the username of the Uploader and not the Groupname that often show up at the end of TPB titles, eg -MeGusta.",
        ),
        text("uploader", ""),
      ],
      implementation: "Cardigann",
      name: "The Pirate Bay",
      priority: 25,
      protocol: "torrent",
      tags: [],
      lifecycle: FIELDS_OWNED_BY_PROWLARR,
    });
  }

  /**
   * PrivateHD, AvistaZ (aka AsiaTorrents) and AnimeZ (ex-AnimeTorrents) are
   * AvistaZ-network trackers sharing the AvistazSettings contract: site
   * username, password and per-account PID, all required. PrivateHD was
   * imported; the other two were created by the stack. Credentials come
   * from 1Password so an apply never nulls them; a PID is the value on the
   * site's My Account / My Profile page (member rank or above is required
   * to use the API).
   */
  private addAvistazNetworkIndexers(): void {
    const trackers = [
      {
        id: "privatehd",
        name: "PrivateHD",
        baseUrl: "https://privatehd.to/",
        username: "root@sjer.red",
        password: "privatehd_password",
        pid: "privatehd_pid",
      },
      {
        id: "avistaz",
        name: "AvistaZ",
        baseUrl: "https://avistaz.to/",
        username: "shprd",
        password: "avistaz_password",
        pid: "avistaz_pid",
      },
      {
        id: "animez",
        name: "AnimeZ",
        baseUrl: "https://animez.to/",
        username: "shprd",
        password: "animez_password",
        pid: "animez_pid",
      },
    ] as const;
    for (const tracker of trackers) {
      new Indexer(this, tracker.id, {
        appProfileId: 1,
        configContract: "AvistazSettings",
        enable: true,
        fields: [
          bool("freeleechOnly", false),
          bool("torrentBaseSettings.preferMagnetUrl", false),
          num("baseSettings.limitsUnit", 0),
          text("baseUrl", tracker.baseUrl),
          sensitive("password", tracker.password),
          sensitive("pid", tracker.pid),
          num("torrentBaseSettings.seedRatio", 3),
          text("username", tracker.username),
        ],
        implementation: tracker.name,
        name: tracker.name,
        priority: 1,
        protocol: "torrent",
        tags: [],
      });
    }
  }
}
