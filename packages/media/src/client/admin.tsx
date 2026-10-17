import { useState, type SyntheticEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  ProviderListSchema,
  SaveProviderSchema,
  SubtitleTargetListSchema,
  ManualSubtitleSchema,
  MAX_MANUAL_SUBTITLE_BYTES,
  type ProviderStatus,
  type SaveProvider,
  type ManualSubtitle,
  type SubtitleTarget,
} from "#shared/admin.ts";
import { readApi, writeApi, queryClient } from "./api.ts";
import { ErrorNotice, Loading, Notice, humanize } from "./components.tsx";

const credentialFields: Readonly<Record<string, readonly string[]>> = {
  privatehd: ["username", "password", "pid"],
  avistaz: ["username", "password", "pid"],
  animez: ["username", "password", "pid"],
  opensubtitles: ["apiKey", "userAgent", "username", "password"],
  assrt: ["token"],
  subhd: ["baseUrl", "token", "instanceId"],
};

function text(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string") throw new TypeError(`Missing ${key}`);
  return value;
}

function providerInput(form: FormData, provider: ProviderStatus): SaveProvider {
  const fields = credentialFields[provider.id] ?? [];
  const credential =
    form.get("replaceCredential") === "on"
      ? Object.fromEntries(
          fields.map((field) => [field, text(form, `credential.${field}`)]),
        )
      : undefined;
  const seedingPolicy: unknown = JSON.parse(text(form, "seedingPolicy"));
  return SaveProviderSchema.parse({
    expectedUpdatedAt: provider.updatedAt,
    enabled: form.get("enabled") === "on",
    configuration: {
      minimumIntervalSeconds: Number(text(form, "minimumIntervalSeconds")),
      dailyDownloadLimit: Number(text(form, "dailyDownloadLimit")),
    },
    seedingPolicy,
    ...(credential === undefined ? {} : { credential }),
  });
}

function ProviderEditor({
  user,
  provider,
}: {
  user: MediaUser;
  provider: ProviderStatus;
}) {
  const [replaceCredential, setReplaceCredential] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fields = credentialFields[provider.id] ?? [];
  const save = useMutation({
    mutationFn: async (input: SaveProvider) =>
      writeApi({
        actorId: user.id,
        path: `/admin/providers/${provider.id}`,
        body: input,
        schema: CommandResultSchema,
        method: "PUT",
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] }),
  });
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      save.mutate(providerInput(new FormData(event.currentTarget), provider));
    } catch {
      setError(
        new Error(
          "Check the credential fields, limits, and seeding policy format.",
        ),
      );
    }
  }
  return (
    <form className="panel stack-form" onSubmit={submit}>
      <h3>{humanize(provider.id)}</h3>
      <p>
        {provider.kind === "tracker" ? "Media discovery" : "Subtitles"} ·{" "}
        {provider.credentialConfigured
          ? "Credentials configured"
          : "No stored credentials"}
      </p>
      <p>
        {provider.lastError === null
          ? "No provider failure recorded. Saving settings does not verify the connection."
          : `Last result: ${humanize(provider.lastError)}`}
      </p>
      {provider.nextAllowedAt !== null && (
        <p>
          Next permitted request:{" "}
          {new Date(provider.nextAllowedAt).toLocaleString()}
        </p>
      )}
      <label>
        <input
          name="enabled"
          type="checkbox"
          defaultChecked={provider.enabled}
        />{" "}
        Enabled
      </label>
      <label>
        Minimum request interval (seconds)
        <input
          name="minimumIntervalSeconds"
          type="number"
          min={1}
          max={3600}
          defaultValue={provider.configuration.minimumIntervalSeconds}
          required
        />
      </label>
      {provider.kind === "subtitle" ? (
        <label>
          Maximum downloads per day
          <input
            name="dailyDownloadLimit"
            type="number"
            min={1}
            max={1000}
            defaultValue={provider.configuration.dailyDownloadLimit}
            required
          />
        </label>
      ) : (
        <input
          type="hidden"
          name="dailyDownloadLimit"
          value={provider.configuration.dailyDownloadLimit}
        />
      )}
      {provider.kind === "tracker" ? (
        <label>
          Seeding policy
          <textarea
            name="seedingPolicy"
            rows={5}
            defaultValue={JSON.stringify(provider.seedingPolicy, null, 2)}
            required
          />
          <small>
            Use {'{"kind":"unknown"}'} to keep seeding until rules are verified.
            Public trackers support {'{"kind":"public"}'}. Private policies
            require the verified rules and supporting evidence.
          </small>
        </label>
      ) : (
        <input type="hidden" name="seedingPolicy" value='{"kind":"unknown"}' />
      )}
      {fields.length > 0 && (
        <fieldset>
          <legend>Credentials</legend>
          <label>
            <input
              name="replaceCredential"
              type="checkbox"
              checked={replaceCredential}
              onChange={(event) => {
                setReplaceCredential(event.target.checked);
              }}
            />{" "}
            {provider.credentialConfigured
              ? "Replace stored credentials"
              : "Configure credentials"}
          </label>
          {replaceCredential &&
            fields.map((field) => (
              <label key={field}>
                {humanize(field)}
                <input
                  name={`credential.${field}`}
                  type={field === "baseUrl" ? "url" : "password"}
                  autoComplete="off"
                  required
                />
              </label>
            ))}
          <small>
            Credentials are encrypted and never returned by this page. Leave
            this unchecked to preserve them.
          </small>
        </fieldset>
      )}
      {error !== null && <ErrorNotice error={error} />}
      {save.error !== null && <ErrorNotice error={save.error} />}
      <button className="button" type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save provider"}
      </button>
    </form>
  );
}

export function ProviderAdministration({ user }: { user: MediaUser }) {
  const providers = useQuery({
    queryKey: ["admin-providers"],
    queryFn: async () => readApi("/admin/providers", ProviderListSchema),
  });
  return (
    <section aria-labelledby="providers-heading">
      <h2 id="providers-heading">Providers</h2>
      {providers.isPending && <Loading />}
      {providers.error !== null && <ErrorNotice error={providers.error} />}
      <div className="item-list">
        {providers.data?.map((provider) => (
          <ProviderEditor
            key={`${provider.id}:${provider.updatedAt ?? "new"}`}
            user={user}
            provider={provider}
          />
        ))}
      </div>
    </section>
  );
}

async function fileBase64(file: File): Promise<string> {
  if (file.size === 0 || file.size > MAX_MANUAL_SUBTITLE_BYTES)
    throw new Error("Choose a subtitle file no larger than 8 MiB.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(new Error("Could not read the subtitle file."));
    });
    reader.addEventListener("load", () => {
      const result =
        typeof reader.result === "string"
          ? reader.result.split(",")[1]
          : undefined;
      if (result === undefined)
        reject(new Error("Could not encode the subtitle file."));
      else resolve(result);
    });
    reader.readAsDataURL(file);
  });
}

async function uploadInput(
  form: FormData,
  target: SubtitleTarget,
): Promise<ManualSubtitle> {
  const file = form.get("subtitle");
  if (!(file instanceof File)) throw new TypeError("Choose a subtitle file.");
  const declaredEncoding = text(form, "encoding");
  return ManualSubtitleSchema.parse({
    assetId: target.assetId,
    expectedAssetVersion: target.version,
    expectedChecksum: target.checksum,
    language: text(form, "language"),
    filename: file.name,
    description: text(form, "description"),
    contentBase64: await fileBase64(file),
    confirmedMatchingVideo: form.get("confirmed") === "on",
    ...(declaredEncoding === "bom" ? {} : { declaredEncoding }),
  });
}

function SubtitleUploader({
  user,
  targets,
}: {
  user: MediaUser;
  targets: SubtitleTarget[];
}) {
  const [error, setError] = useState<Error | null>(null);
  const upload = useMutation({
    mutationFn: async (input: ManualSubtitle) =>
      writeApi({
        actorId: user.id,
        path: "/admin/subtitles",
        body: input,
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["subtitle-targets"] }),
  });
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    try {
      const data = new FormData(form);
      const target = targets.find(
        (item) => item.assetId === text(data, "assetId"),
      );
      if (target === undefined)
        throw new Error("Select the exact video version.");
      await upload.mutateAsync(await uploadInput(data, target));
      form.reset();
    } catch {
      setError(
        new Error(
          "The upload was not accepted. Check the video selection, file, and confirmation.",
        ),
      );
    }
  }
  return (
    <form
      className="panel stack-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label>
        Exact video version
        <select name="assetId" required defaultValue="">
          <option value="" disabled>
            Select a video
          </option>
          {targets.map((target) => (
            <option key={target.assetId} value={target.assetId}>
              {target.titles.join(" / ")} — {target.filename} (version{" "}
              {target.version})
            </option>
          ))}
        </select>
      </label>
      <label>
        Language
        <select name="language">
          <option value="en">English</option>
          <option value="zh-Hans">Simplified Chinese</option>
        </select>
      </label>
      <label>
        Subtitle file
        <input
          name="subtitle"
          type="file"
          accept=".srt,.ass,.ssa,.vtt"
          required
        />
      </label>
      <label>
        Encoding
        <select name="encoding">
          <option value="bom">UTF-8 or Unicode BOM</option>
          <option value="gb18030">GB18030 (confirmed by source)</option>
          <option value="utf-16le">UTF-16 little endian</option>
          <option value="utf-16be">UTF-16 big endian</option>
        </select>
      </label>
      <label>
        Source and matching evidence
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          placeholder="Human translator/source and the release this subtitle matches"
          required
        />
      </label>
      <label>
        <input type="checkbox" name="confirmed" required /> I confirmed this
        subtitle matches the selected video version and episode.
      </label>
      <p>
        SRT, ASS, SSA, or WebVTT, up to 8 MiB. Existing subtitles in the same
        language require replacement review.
      </p>
      {error !== null && <ErrorNotice error={error} />}
      {upload.error !== null && <ErrorNotice error={upload.error} />}
      {upload.isSuccess && (
        <Notice>Subtitle validated and queued for installation.</Notice>
      )}
      <button
        className="button"
        type="submit"
        disabled={upload.isPending || targets.length === 0}
      >
        {upload.isPending ? "Uploading…" : "Validate and install subtitle"}
      </button>
    </form>
  );
}

export function ManualSubtitleAdministration({ user }: { user: MediaUser }) {
  const [search, setSearch] = useState("");
  const targets = useQuery({
    queryKey: ["subtitle-targets", search],
    queryFn: async () =>
      readApi(
        `/admin/subtitles/targets?q=${encodeURIComponent(search)}`,
        SubtitleTargetListSchema,
      ),
  });
  return (
    <section aria-labelledby="upload-heading">
      <h2 id="upload-heading">Upload subtitles</h2>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(text(new FormData(event.currentTarget), "query"));
        }}
      >
        <label>
          Find a video
          <input name="query" type="search" maxLength={200} />
        </label>
        <button className="button" type="submit">
          Search library
        </button>
      </form>
      {targets.isPending && <Loading />}
      {targets.error !== null && <ErrorNotice error={targets.error} />}
      {targets.data !== undefined && (
        <SubtitleUploader user={user} targets={targets.data} />
      )}
    </section>
  );
}
