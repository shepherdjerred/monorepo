/** A small deterministic PRNG (SplitMix32) so a seed reproduces a batch exactly. */
export class Rng {
  private state: number;

  constructor(seed: string) {
    // FNV-1a over the seed string; any stable 32-bit hash would do.
    let hash = 0x81_1c_9d_c5;
    for (const char of seed) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01_00_01_93);
    }
    this.state = hash >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x9e_37_79_b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x85_eb_ca_6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2_b2_ae_35);
    z ^= z >>> 16;
    return (z >>> 0) / 0x1_00_00_00_00;
  }

  /** An integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** A float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** A standard normal deviate (Box-Muller). */
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) {
      throw new Error("cannot pick from an empty list");
    }
    return item;
  }

  /** A new array with the items in random order (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = copy[i];
      const b = copy[j];
      if (a !== undefined && b !== undefined) {
        copy[i] = b;
        copy[j] = a;
      }
    }
    return copy;
  }

  /** `n` distinct items, in random order. */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, n);
  }

  /** An independent stream, so one subsystem's draws never shift another's. */
  fork(label: string): Rng {
    return new Rng(`${String(this.int(0x7f_ff_ff_ff))}:${label}`);
  }
}

/** Rounds to `digits` decimals, avoiding `-0`. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
