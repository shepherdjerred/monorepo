import { X509Certificate } from "node:crypto";
import { stat } from "node:fs/promises";

export type TlsCertificateMaterial = {
  readonly cert: string;
  readonly key: string;
  readonly expiresAtIso: string;
  readonly expiresAtEpochSeconds: number;
};

type CachedCertificateEntry = {
  readonly certMtimeMs: number;
  readonly certCtimeMs: number;
  readonly certIno: number;
  readonly certSize: number;
  readonly keyMtimeMs: number;
  readonly keyCtimeMs: number;
  readonly keyIno: number;
  readonly keySize: number;
  readonly material: TlsCertificateMaterial;
};

export class TlsCertificateLoader {
  readonly #certPath: string;
  readonly #keyPath: string;
  #cached: CachedCertificateEntry | null = null;

  constructor(options: {
    readonly certPath: string;
    readonly keyPath: string;
  }) {
    this.#certPath = options.certPath;
    this.#keyPath = options.keyPath;
  }

  async load(): Promise<TlsCertificateMaterial> {
    const [certStat, keyStat] = await Promise.all([
      stat(this.#certPath),
      stat(this.#keyPath),
    ]);

    if (
      this.#cached !== null &&
      this.#cached.certMtimeMs === certStat.mtimeMs &&
      this.#cached.certCtimeMs === certStat.ctimeMs &&
      this.#cached.certIno === certStat.ino &&
      this.#cached.certSize === certStat.size &&
      this.#cached.keyMtimeMs === keyStat.mtimeMs &&
      this.#cached.keyCtimeMs === keyStat.ctimeMs &&
      this.#cached.keyIno === keyStat.ino &&
      this.#cached.keySize === keyStat.size
    ) {
      return this.#cached.material;
    }

    const [cert, key] = await Promise.all([
      Bun.file(this.#certPath).text(),
      Bun.file(this.#keyPath).text(),
    ]);

    const x509 = new X509Certificate(cert);
    const expiryDate = new Date(x509.validTo);
    if (Number.isNaN(expiryDate.getTime())) {
      throw new TypeError(`Unable to parse X509 validTo date: ${x509.validTo}`);
    }

    const material: TlsCertificateMaterial = {
      cert,
      key,
      expiresAtIso: expiryDate.toISOString(),
      expiresAtEpochSeconds: Math.floor(expiryDate.getTime() / 1000),
    };

    this.#cached = {
      certMtimeMs: certStat.mtimeMs,
      certCtimeMs: certStat.ctimeMs,
      certIno: certStat.ino,
      certSize: certStat.size,
      keyMtimeMs: keyStat.mtimeMs,
      keyCtimeMs: keyStat.ctimeMs,
      keyIno: keyStat.ino,
      keySize: keyStat.size,
      material,
    };

    return material;
  }
}
