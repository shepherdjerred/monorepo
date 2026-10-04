import type { ProviderKind, SandboxCreateRequest } from "#protocol/ipc.ts";
import { providerFor } from "#sandbox/profiles.ts";
import type {
  Progress,
  SandboxBackend,
  SandboxProvider,
} from "#sandbox/provider.ts";
import type { SandboxRecord, SandboxStore } from "#sandbox/record.ts";

/**
 * Every configured provider behind one SandboxBackend. Creates go to the
 * request's provider (else the profile's default); everything else routes by
 * the record's provider. Only the default provider is preflighted at daemon
 * start, so a workstation without cluster access still runs Docker sandboxes;
 * the others are checked on their first create.
 */
export class SandboxProviders implements SandboxBackend {
  private readonly checked = new Set<ProviderKind>();

  constructor(
    private readonly providers: Readonly<
      Partial<Record<ProviderKind, SandboxProvider>>
    >,
    private readonly store: SandboxStore,
    private readonly defaultKind: ProviderKind = "docker",
  ) {}

  private provider(kind: ProviderKind): SandboxProvider {
    const provider = this.providers[kind];
    if (provider === undefined) {
      throw new Error(`The ${kind} sandbox provider is not configured`);
    }
    return provider;
  }

  private configured(): SandboxProvider[] {
    return Object.values(this.providers);
  }

  async preflight(): Promise<void> {
    await this.provider(this.defaultKind).preflight();
    this.checked.add(this.defaultKind);
  }

  async create(
    request: SandboxCreateRequest,
    progress: Progress,
  ): Promise<SandboxRecord> {
    const kind = providerFor(request);
    const provider = this.provider(kind);
    if (!this.checked.has(kind)) {
      await provider.preflight();
      this.checked.add(kind);
    }
    return provider.create(request, progress);
  }

  async list(): Promise<SandboxRecord[]> {
    const lists = await Promise.all(
      this.configured().map(async (provider) => provider.list()),
    );
    return lists.flat();
  }

  async destroy(id: string): Promise<void> {
    const record = await this.store.read(id);
    // Without a record the sandbox may still exist on the default backend.
    await this.provider(record?.provider ?? this.defaultKind).destroy(id);
  }

  async reap(now: Date): Promise<string[]> {
    const reaped: string[] = [];
    for (const provider of this.configured()) {
      reaped.push(...(await provider.reap(now)));
    }
    return reaped;
  }

  async logs(record: SandboxRecord, tail: number): Promise<string[]> {
    return this.provider(record.provider).logs(record, tail);
  }
}
