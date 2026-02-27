// Use globalThis.crypto.subtle for type compatibility with global CryptoKey.
const { subtle } = globalThis.crypto;

const AES_BLOCK_SIZE = 16;
const AES_BLOCK_R = 135;

function asBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return new Uint8Array(ab);
}

function xorBlocks(a: Uint8Array, b: Uint8Array): void {
  for (const [i, element] of b.entries()) {
    const av = a[i] ?? 0;
    const bv = element;
    a[i] = av ^ bv;
  }
}

// Block type used in CMAC and SIV computations
class Block {
  data: Uint8Array;

  constructor() {
    this.data = new Uint8Array(AES_BLOCK_SIZE);
  }

  clear(): void {
    this.data.fill(0);
  }

  clone(): Block {
    const b = new Block();
    b.data.set(this.data);
    return b;
  }

  dbl(): void {
    let carry = 0;
    for (let i = AES_BLOCK_SIZE - 1; i >= 0; i--) {
      const current = this.data[i] ?? 0;
      const overflow = (current >>> 7) & 0xFF;
      this.data[i] = ((current << 1) | carry) & 0xFF;
      carry = overflow;
    }
    // Conditional XOR with R (135) based on carry
    const last = this.data[AES_BLOCK_SIZE - 1] ?? 0;
    this.data[AES_BLOCK_SIZE - 1] =
      last ^ ((~(carry - 1) & AES_BLOCK_R) | ((carry - 1) & 0));
  }
}

// CMAC cipher (AES-CBC based)
class CmacCipher {
  private readonly key: CryptoKey;
  private readonly iv: Block;

  constructor(key: CryptoKey) {
    this.key = key;
    this.iv = new Block();
  }

  async encryptBlock(block: Block): Promise<void> {
    const result = await subtle.encrypt(
      { name: "AES-CBC", iv: asBufferSource(this.iv.data) },
      this.key,
      asBufferSource(block.data),
    );
    block.data.set(new Uint8Array(result, 0, AES_BLOCK_SIZE));
  }
}

// CMAC (message authentication code)
class Cmac {
  private readonly cipher: CmacCipher;
  private readonly subkey1: Block;
  private readonly subkey2: Block;
  private bufferPos: number;
  private finished: boolean;
  private readonly buffer: Block;

  constructor(cipher: CmacCipher, subkey1: Block, subkey2: Block) {
    this.cipher = cipher;
    this.subkey1 = subkey1;
    this.subkey2 = subkey2;
    this.bufferPos = 0;
    this.finished = false;
    this.buffer = new Block();
  }

  static async importKey(macKey: CryptoKey): Promise<() => Cmac> {
    const cipher = new CmacCipher(macKey);
    const block = new Block();
    await cipher.encryptBlock(block);
    block.dbl();
    const subkey2 = block.clone();
    subkey2.dbl();
    return () => new Cmac(cipher, block, subkey2);
  }

  async update(data: Uint8Array): Promise<this> {
    if (this.finished) {
      throw new Error("Cannot update finished CMAC");
    }

    const remaining = AES_BLOCK_SIZE - this.bufferPos;
    let offset = 0;
    let length = data.length;

    if (length > remaining) {
      for (let i = 0; i < remaining; i++) {
        const bufVal = this.buffer.data[this.bufferPos + i] ?? 0;
        const dataVal = data[i] ?? 0;
        this.buffer.data[this.bufferPos + i] = bufVal ^ dataVal;
      }
      length -= remaining;
      offset += remaining;
      await this.cipher.encryptBlock(this.buffer);
      this.bufferPos = 0;
    }

    while (length > AES_BLOCK_SIZE) {
      for (let i = 0; i < AES_BLOCK_SIZE; i++) {
        const bufVal = this.buffer.data[i] ?? 0;
        const dataVal = data[offset + i] ?? 0;
        this.buffer.data[i] = bufVal ^ dataVal;
      }
      length -= AES_BLOCK_SIZE;
      offset += AES_BLOCK_SIZE;
      await this.cipher.encryptBlock(this.buffer);
    }

    for (let i = 0; i < length; i++) {
      const bufVal = this.buffer.data[this.bufferPos] ?? 0;
      const dataVal = data[offset + i] ?? 0;
      this.buffer.data[this.bufferPos] = bufVal ^ dataVal;
      this.bufferPos++;
    }

    return this;
  }

  async finish(): Promise<Uint8Array> {
    if (!this.finished) {
      const subkey =
        this.bufferPos < AES_BLOCK_SIZE ? this.subkey2 : this.subkey1;
      xorBlocks(this.buffer.data, subkey.data);
      if (this.bufferPos < AES_BLOCK_SIZE) {
        const val = this.buffer.data[this.bufferPos] ?? 0;
        this.buffer.data[this.bufferPos] = val ^ 0x80;
      }
      await this.cipher.encryptBlock(this.buffer);
      this.finished = true;
    }
    return this.buffer.data;
  }
}

// Clear bits 31 and 63 of the SIV tag for use as CTR counter
function clearSivBits(siv: Uint8Array): void {
  const idx8 = siv.length - 8;
  const idx4 = siv.length - 4;
  siv[idx8] = (siv[idx8] ?? 0) & 0x7F;
  siv[idx4] = (siv[idx4] ?? 0) & 0x7F;
}

// AES-SIV implementation
export class AesSiv {
  private readonly cmacFactory: () => Cmac;
  private readonly ctrKey: CryptoKey;

  constructor(cmacFactory: () => Cmac, ctrKey: CryptoKey) {
    this.cmacFactory = cmacFactory;
    this.ctrKey = ctrKey;
  }

  static async importKeys(
    sivEncKey: CryptoKey,
    sivMacKey: CryptoKey,
  ): Promise<AesSiv> {
    const cmacFactory = await Cmac.importKey(sivMacKey);
    return new AesSiv(cmacFactory, sivEncKey);
  }

  private async s2v(plaintext: Uint8Array): Promise<Uint8Array> {
    const cmac1 = this.cmacFactory();
    const zero = new Block();
    const d = new Block();
    await cmac1.update(zero.data);
    d.data.set(await cmac1.finish());

    const cmac2 = this.cmacFactory();
    zero.clear();

    if (plaintext.length >= AES_BLOCK_SIZE) {
      const n = plaintext.length - AES_BLOCK_SIZE;
      const tail = new Block();
      tail.data.set(plaintext.subarray(n));
      await cmac2.update(plaintext.subarray(0, n));
      xorBlocks(tail.data, d.data);
      await cmac2.update(tail.data);
    } else {
      const padded = new Block();
      padded.data.set(plaintext);
      padded.data[plaintext.length] = 0x80;
      d.dbl();
      xorBlocks(padded.data, d.data);
      await cmac2.update(padded.data);
    }

    return cmac2.finish();
  }

  async seal(plaintext: Uint8Array): Promise<Uint8Array> {
    const totalLength = AES_BLOCK_SIZE + plaintext.length;
    const output = new Uint8Array(totalLength);

    const siv = await this.s2v(plaintext);
    output.set(siv);

    const counter = new Uint8Array(siv);
    clearSivBits(counter);

    const encrypted = await subtle.encrypt(
      { name: "AES-CTR", counter: asBufferSource(counter), length: AES_BLOCK_SIZE },
      this.ctrKey,
      asBufferSource(plaintext),
    );
    output.set(new Uint8Array(encrypted), siv.length);

    return output;
  }

  async open(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (ciphertext.length < AES_BLOCK_SIZE) {
      throw new Error("AES-SIV: ciphertext is truncated");
    }

    const sivTag = ciphertext.subarray(0, AES_BLOCK_SIZE);
    const counter = new Uint8Array(AES_BLOCK_SIZE);
    counter.set(sivTag);
    clearSivBits(counter);

    const decrypted = new Uint8Array(
      await subtle.encrypt(
        { name: "AES-CTR", counter: asBufferSource(counter), length: AES_BLOCK_SIZE },
        this.ctrKey,
        asBufferSource(ciphertext.subarray(AES_BLOCK_SIZE)),
      ),
    );

    const computedSiv = await this.s2v(decrypted);

    // Constant-time comparison
    if (sivTag.length !== computedSiv.length) {
      throw new Error("AES-SIV: ciphertext verification failure!");
    }
    let diff = 0;
    for (const [i, element] of sivTag.entries()) {
      diff |= element ^ (computedSiv[i] ?? 0);
    }
    if (diff !== 0) {
      decrypted.fill(0);
      throw new Error("AES-SIV: ciphertext verification failure!");
    }

    return decrypted;
  }
}
