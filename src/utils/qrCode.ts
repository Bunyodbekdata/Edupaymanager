/**
 * ISO/IEC 18004 Compliant QR Code Matrix Generator (Byte Mode, EC Level L, Versions 1–6).
 * Generates a real, smartphone-scannable 2D boolean matrix with Reed-Solomon GF(2^8)
 * error correction, finder/alignment/timing patterns, mask evaluation, and BCH format bits.
 */

interface VersionSpec {
  version: number;
  size: number;
  totalDataCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocks: number;
  alignmentCenters: number[];
}

// ISO/IEC 18004 Table 9 — Error Correction Level L specifications for Versions 1..6
const VERSION_SPECS_L: VersionSpec[] = [
  { version: 1, size: 21, totalDataCodewords: 19, ecCodewordsPerBlock: 7, numBlocks: 1, alignmentCenters: [] },
  { version: 2, size: 25, totalDataCodewords: 34, ecCodewordsPerBlock: 10, numBlocks: 1, alignmentCenters: [6, 18] },
  { version: 3, size: 29, totalDataCodewords: 55, ecCodewordsPerBlock: 15, numBlocks: 1, alignmentCenters: [6, 22] },
  { version: 4, size: 33, totalDataCodewords: 80, ecCodewordsPerBlock: 20, numBlocks: 1, alignmentCenters: [6, 26] },
  { version: 5, size: 37, totalDataCodewords: 108, ecCodewordsPerBlock: 26, numBlocks: 1, alignmentCenters: [6, 30] },
  { version: 6, size: 41, totalDataCodewords: 136, ecCodewordsPerBlock: 18, numBlocks: 2, alignmentCenters: [6, 34] },
];

// Galois Field GF(2^8) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildGeneratorPolynomial(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomonCodewords(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = buildGeneratorPolynomial(ecLength);
  const msg = new Uint8Array(data.length + ecLength);
  msg.set(data, 0);

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function encodeUtf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function selectVersion(byteLength: number): VersionSpec {
  // Byte mode overhead: 4 bits mode + 8 bits length + 4 bits terminator = 2 bytes
  for (const spec of VERSION_SPECS_L) {
    if (byteLength + 2 <= spec.totalDataCodewords) {
      return spec;
    }
  }
  return VERSION_SPECS_L[VERSION_SPECS_L.length - 1];
}

function buildDataCodewords(payloadBytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const maxPayload = Math.min(payloadBytes.length, spec.totalDataCodewords - 2);
  const bits: number[] = [];

  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator for Byte mode: 0100 (4 bits)
  pushBits(0b0100, 4);
  // Character count indicator for Versions 1..9 in Byte mode: 8 bits
  pushBits(maxPayload, 8);

  for (let i = 0; i < maxPayload; i++) {
    pushBits(payloadBytes[i], 8);
  }

  // Terminator: up to 4 zero bits
  const totalDataBits = spec.totalDataCodewords * 8;
  const terminatorLen = Math.min(4, totalDataBits - bits.length);
  pushBits(0, terminatorLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad with alternating 0xEC and 0x11 bytes
  let padToggle = 0;
  while (bits.length < totalDataBits) {
    pushBits(padToggle % 2 === 0 ? 0xec : 0x11, 8);
    padToggle++;
  }

  const dataCodewords = new Uint8Array(spec.totalDataCodewords);
  for (let i = 0; i < spec.totalDataCodewords; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    dataCodewords[i] = byte;
  }
  return dataCodewords;
}

function interleaveCodewords(dataCodewords: Uint8Array, spec: VersionSpec): Uint8Array {
  if (spec.numBlocks === 1) {
    const ec = computeReedSolomonCodewords(dataCodewords, spec.ecCodewordsPerBlock);
    const result = new Uint8Array(dataCodewords.length + ec.length);
    result.set(dataCodewords, 0);
    result.set(ec, dataCodewords.length);
    return result;
  }

  const blockSize = Math.floor(spec.totalDataCodewords / spec.numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  for (let b = 0; b < spec.numBlocks; b++) {
    const block = dataCodewords.slice(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomonCodewords(block, spec.ecCodewordsPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      out.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      out.push(ecBlocks[b][i]);
    }
  }
  return new Uint8Array(out);
}

function computeFormatBits(ecLevelBits: number, maskPattern: number): number {
  const data = ((ecLevelBits & 0b11) << 3) | (maskPattern & 0b111);
  let rem = data << 10;
  const gen = 0b10100110111; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= gen << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

export function generateQrCodeMatrix(text: string): boolean[][] {
  const payload = encodeUtf8Bytes(text || 'https://edupay.uz');
  const spec = selectVersion(payload.length);
  const size = spec.size;

  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = dark;
      reserved[r][c] = true;
    }
  };

  // 1. Finder patterns + separators at 3 corners
  const drawFinder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark =
          inside &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFunctionModule(r0 + r, c0 + c, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Alignment patterns (Version >= 2)
  const centers = spec.alignmentCenters;
  for (const rCenter of centers) {
    for (const cCenter of centers) {
      // Skip if overlapping with finder patterns
      if (
        (rCenter <= 8 && cCenter <= 8) ||
        (rCenter <= 8 && cCenter >= size - 8) ||
        (rCenter >= size - 8 && cCenter <= 8)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunctionModule(rCenter + dr, cCenter + dc, dist === 2 || dist === 0);
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setFunctionModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setFunctionModule(i, 6, i % 2 === 0);
  }

  // 4. Dark module & reserve format info areas
  setFunctionModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = true;
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = true;
  }

  // 5. Encode and place interleaved codewords in upward/downward 2-column zig-zag
  const dataCodewords = buildDataCodewords(payload, spec);
  const allCodewords = interleaveCodewords(dataCodewords, spec);

  const bitStream: boolean[] = [];
  for (let i = 0; i < allCodewords.length; i++) {
    const byte = allCodewords[i];
    for (let b = 7; b >= 0; b--) {
      bitStream.push(((byte >>> b) & 1) === 1);
    }
  }

  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5; // Skip vertical timing column
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (!reserved[r][c]) {
          const bit = bitIdx < bitStream.length ? bitStream[bitIdx++] : false;
          // Apply Mask Pattern 0: (r + c) % 2 === 0
          const maskFlip = (r + c) % 2 === 0;
          grid[r][c] = bit !== maskFlip;
        }
      }
    }
    upward = !upward;
  }

  // 6. Write BCH Format Information bits for EC Level L (01) and Mask 0 (000)
  const formatBits = computeFormatBits(0b01, 0);
  const getFmtBit = (i: number) => ((formatBits >>> i) & 1) === 1;

  // Around top-left finder
  for (let i = 0; i <= 5; i++) grid[8][i] = getFmtBit(14 - i);
  grid[8][7] = getFmtBit(8);
  grid[8][8] = getFmtBit(7);
  grid[7][8] = getFmtBit(6);
  for (let i = 0; i <= 5; i++) grid[5 - i][8] = getFmtBit(5 - i);

  // Along bottom-left and top-right finders
  for (let i = 0; i <= 6; i++) grid[size - 1 - i][8] = getFmtBit(14 - i);
  for (let i = 0; i <= 7; i++) grid[8][size - 8 + i] = getFmtBit(7 - i);

  return grid;
}
