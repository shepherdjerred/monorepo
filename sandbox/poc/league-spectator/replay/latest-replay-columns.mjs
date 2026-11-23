// Lossless, structured-cloneable diagnostic rows. Numeric columns retain IEEE
// doubles; strings retain UTF-16 code units (ASCII columns use one byte). Nested
// values are shared dictionaries and cloned only when a row is requested.
const kind = "lossless-replay-columns-v1";
const approved = new WeakSet();
const fieldMaps = new WeakMap();
const decodedRows = new WeakMap();
const binaryKind = "replay-binary-view-v1";
const binaryTypes = new Map(
  [
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float64Array,
  ].map((type) => [type.name, type]),
);
function binaryView(value) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join("|") !==
      "buffer|byteOffset|kind|length|type" ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !Object.hasOwn(descriptor, "value"),
    ) ||
    value.kind !== binaryKind ||
    !binaryTypes.has(value.type) ||
    !(value.buffer instanceof ArrayBuffer) ||
    Object.getPrototypeOf(value.buffer) !== ArrayBuffer.prototype ||
    Reflect.ownKeys(value.buffer).length !== 0
  )
    throw Error("Plain replay binary envelope required");
  const Constructor = binaryTypes.get(value.type);
  if (
    !Number.isSafeInteger(value.byteOffset) ||
    value.byteOffset < 0 ||
    value.byteOffset % Constructor.BYTES_PER_ELEMENT !== 0 ||
    !Number.isSafeInteger(value.length) ||
    value.length < 0 ||
    value.byteOffset + value.length * Constructor.BYTES_PER_ELEMENT >
      value.buffer.byteLength
  )
    throw Error("Replay binary envelope span exceeds owned buffer");
  return new Constructor(value.buffer, value.byteOffset, value.length);
}
function wire(value) {
  if (ArrayBuffer.isView(value))
    return {
      kind: binaryKind,
      type: value.constructor.name,
      buffer: value.buffer,
      byteOffset: value.byteOffset,
      length: value.length,
    };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, wire(entry)]),
    );
  return value;
}
function hydrate(value) {
  if (!value || value.kind !== kind || !Array.isArray(value.groups))
    throw Error("Lossless replay column wire required");
  return {
    ...value,
    groupIds: binaryView(value.groupIds),
    rowOffsets: binaryView(value.rowOffsets),
    groups: value.groups.map((group) => ({
      ...group,
      fields: group.fields.map(({ name, column: entry }) => ({
        name,
        column: {
          ...entry,
          ...(entry.data === undefined ? {} : { data: binaryView(entry.data) }),
          ...(entry.offsets === undefined
            ? {}
            : { offsets: binaryView(entry.offsets) }),
          ...(entry.indices === undefined
            ? {}
            : { indices: binaryView(entry.indices) }),
        },
      })),
    })),
  };
}
const category = (value) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "nested"
      : typeof value === "object"
        ? "nested"
        : typeof value;
const fingerprint = (value) => {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw Error("Finite replay column values required");
    return Object.is(value, -0) ? "n-0" : `n${value}`;
  }
  if (typeof value === "string") return `s${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `a[${value.map(fingerprint).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `o{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}:${fingerprint(entry)}`)
      .join(",")}}`;
  throw Error("Plain replay row values required");
};

function strings(values) {
  if (values.every((value) => value === values[0]))
    return { type: "constant", value: values[0] };
  let length = 0,
    ascii = true,
    hex = values.every((value) => /^(?:[0-9a-f]{2})*$/.test(value));
  const offsets = new Uint32Array(values.length + 1);
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    length += hex ? value.length / 2 : value.length;
    if (length > 0xffffffff)
      throw Error("Replay string column exceeds bounded offsets");
    offsets[index + 1] = length;
    for (let at = 0; ascii && at < value.length; at++)
      ascii = value.charCodeAt(at) < 128;
  }
  const data = hex || ascii ? new Uint8Array(length) : new Uint16Array(length);
  for (let index = 0; index < values.length; index++)
    for (let at = 0; at < values[index].length; at += hex ? 2 : 1) {
      const first = values[index].charCodeAt(at);
      if (hex) {
        const second = values[index].charCodeAt(at + 1);
        data[offsets[index] + at / 2] =
          (first > 96 ? first - 87 : first - 48) * 16 +
          (second > 96 ? second - 87 : second - 48);
      } else data[offsets[index] + at] = first;
    }
  return { type: hex ? "hex" : "strings", data, offsets };
}
function column(values, type) {
  if (type === "null") return { type: "constant", value: null };
  if (type === "number") {
    if (!values.every(Number.isFinite))
      throw Error("Finite replay number column required");
    if (values.every((value) => Object.is(value, values[0])))
      return { type: "constant", value: values[0] };
    let minimum = Infinity,
      maximum = -Infinity;
    for (const value of values) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    let NumericArray = Float64Array;
    if (
      values.every((value) => Number.isInteger(value) && !Object.is(value, -0))
    ) {
      if (minimum >= 0 && maximum <= 0xff) NumericArray = Uint8Array;
      else if (minimum >= 0 && maximum <= 0xffff) NumericArray = Uint16Array;
      else if (minimum >= 0 && maximum <= 0xffffffff)
        NumericArray = Uint32Array;
      else if (minimum >= -0x80 && maximum <= 0x7f) NumericArray = Int8Array;
      else if (minimum >= -0x8000 && maximum <= 0x7fff)
        NumericArray = Int16Array;
      else if (minimum >= -0x80000000 && maximum <= 0x7fffffff)
        NumericArray = Int32Array;
    }
    return { type: "numbers", data: new NumericArray(values) };
  }
  if (type === "boolean")
    return { type: "booleans", data: Uint8Array.from(values, Number) };
  if (type === "string") return strings(values);
  if (type !== "nested") throw Error("Unsupported replay row column type");
  const dictionary = [],
    known = new Map(),
    indices = new Uint32Array(values.length);
  for (let index = 0; index < values.length; index++) {
    const key = fingerprint(values[index]);
    if (!known.has(key)) {
      known.set(key, dictionary.length);
      dictionary.push(structuredClone(values[index]));
    }
    indices[index] = known.get(key);
  }
  return { type: "dictionary", indices, dictionary };
}

export function packReplayRows(rows) {
  if (!Array.isArray(rows))
    throw Error("Original replay rows required for packing");
  const groups = [],
    schemas = new Map(),
    groupIds = new Uint16Array(rows.length),
    rowOffsets = new Uint32Array(rows.length);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || Object.getPrototypeOf(row) !== Object.prototype)
      throw Error("Plain replay row required");
    const keys = Object.keys(row),
      types = keys.map((key) => category(row[key])),
      schema = JSON.stringify([keys, types]);
    if (!schemas.has(schema)) {
      if (groups.length >= 65536)
        throw Error("Replay row shape inventory exceeds uint16");
      schemas.set(schema, groups.length);
      groups.push({ keys, types, rows: [] });
    }
    const group = schemas.get(schema),
      pending = groups[group];
    groupIds[index] = group;
    rowOffsets[index] = pending.rows.length;
    pending.rows.push(row);
  }
  const packed = {
    kind,
    length: rows.length,
    groupIds,
    rowOffsets,
    groups: groups.map((group) => ({
      length: group.rows.length,
      fields: group.keys.map((name, index) => ({
        name,
        column: column(
          group.rows.map((row) => row[name]),
          group.types[index],
        ),
      })),
    })),
  };
  validateInternal(packed);
  const result = wire(packed);
  decodedRows.set(result, packed);
  return result;
}

function validate(value) {
  let decoded = decodedRows.get(value);
  if (decoded === undefined) {
    decoded = hydrate(value);
    validateInternal(decoded);
    decodedRows.set(value, decoded);
  }
  if (
    decoded.groupIds.length !== decoded.length ||
    decoded.rowOffsets.length !== decoded.length
  )
    throw Error("Replay column storage was transferred to another owner");
  return decoded;
}
function validateInternal(value) {
  if (approved.has(value)) return value;
  if (
    !value ||
    value.kind !== kind ||
    !Number.isSafeInteger(value.length) ||
    value.length < 0 ||
    !(value.groupIds instanceof Uint16Array) ||
    !(value.rowOffsets instanceof Uint32Array) ||
    value.groupIds.length !== value.length ||
    value.rowOffsets.length !== value.length ||
    !Array.isArray(value.groups) ||
    value.groups.length > 65536
  )
    throw Error("Bounded lossless replay columns required");
  for (const group of value.groups) {
    if (
      !Number.isSafeInteger(group.length) ||
      group.length < 0 ||
      !Array.isArray(group.fields) ||
      new Set(group.fields.map((field) => field.name)).size !==
        group.fields.length
    )
      throw Error("Distinct replay column fields required");
    for (const { name, column: entry } of group.fields) {
      if (typeof name !== "string" || !entry)
        throw Error("Named replay columns required");
      if (entry.type === "constant") fingerprint(entry.value);
      else if (entry.type === "numbers") {
        if (
          ![
            Float64Array,
            Uint8Array,
            Uint16Array,
            Uint32Array,
            Int8Array,
            Int16Array,
            Int32Array,
          ].some((NumericArray) => entry.data instanceof NumericArray) ||
          entry.data.length !== group.length ||
          !entry.data.every(Number.isFinite)
        )
          throw Error("Finite replay numeric storage required");
      } else if (entry.type === "booleans") {
        if (
          !(entry.data instanceof Uint8Array) ||
          entry.data.length !== group.length ||
          !entry.data.every((item) => item < 2)
        )
          throw Error("Replay boolean storage required");
      } else if (entry.type === "strings" || entry.type === "hex") {
        if (
          !(
            entry.data instanceof Uint8Array ||
            (entry.type === "strings" && entry.data instanceof Uint16Array)
          ) ||
          !(entry.offsets instanceof Uint32Array) ||
          entry.offsets.length !== group.length + 1 ||
          entry.offsets[0] !== 0 ||
          entry.offsets[group.length] !== entry.data.length ||
          !entry.offsets.every(
            (offset, index) =>
              index === 0 || offset >= entry.offsets[index - 1],
          )
        )
          throw Error("Bounded replay string storage required");
      } else if (entry.type === "dictionary") {
        if (
          !(entry.indices instanceof Uint32Array) ||
          entry.indices.length !== group.length ||
          !Array.isArray(entry.dictionary) ||
          !entry.indices.every((index) => index < entry.dictionary.length)
        )
          throw Error("Bounded replay dictionary storage required");
        for (const item of entry.dictionary) fingerprint(item);
      } else throw Error("Unknown replay column storage type");
    }
    fieldMaps.set(
      group,
      new Map(group.fields.map((field) => [field.name, field.column])),
    );
  }
  for (let index = 0; index < value.length; index++) {
    const group = value.groups[value.groupIds[index]];
    if (!group || value.rowOffsets[index] >= group.length)
      throw Error("Replay row index escaped column group");
  }
  approved.add(value);
  return value;
}
function readColumn(entry, index) {
  if (entry.type === "constant") return entry.value;
  if (entry.type === "numbers") return entry.data[index];
  if (entry.type === "booleans") return entry.data[index] === 1;
  if (entry.type === "dictionary")
    return structuredClone(entry.dictionary[entry.indices[index]]);
  const start = entry.offsets[index],
    end = entry.offsets[index + 1];
  let value = "";
  if (entry.type === "hex") {
    for (let at = start; at < end; at++)
      value += entry.data[at].toString(16).padStart(2, "0");
    return value;
  }
  for (let at = start; at < end; at += 8192)
    value += String.fromCharCode(
      ...entry.data.subarray(at, Math.min(at + 8192, end)),
    );
  return value;
}
export function isReplayRows(value) {
  return (
    Array.isArray(value) ||
    Boolean(value && value.kind === kind && validate(value))
  );
}
export function replayRowCount(value) {
  if (Array.isArray(value)) return value.length;
  return validate(value).length;
}
export function replayRowAt(value, index) {
  if (Array.isArray(value)) return value[index];
  const decoded = validate(value);
  if (!Number.isInteger(index) || index < 0 || index >= value.length)
    return undefined;
  const group = decoded.groups[decoded.groupIds[index]],
    offset = decoded.rowOffsets[index];
  return Object.fromEntries(
    group.fields.map(({ name, column: entry }) => [
      name,
      readColumn(entry, offset),
    ]),
  );
}
export function replayRowProjection(value, index, fields) {
  if (Array.isArray(value))
    return Object.fromEntries(
      fields
        .filter((name) => Object.hasOwn(value[index], name))
        .map((name) => [name, value[index][name]]),
    );
  const decoded = validate(value);
  if (!Number.isInteger(index) || index < 0 || index >= value.length)
    throw Error("Replay projection index escaped column bounds");
  const group = decoded.groups[decoded.groupIds[index]],
    offset = decoded.rowOffsets[index],
    columns = fieldMaps.get(group);
  return Object.fromEntries(
    fields
      .filter((name) => columns.has(name))
      .map((name) => [name, readColumn(columns.get(name), offset)]),
  );
}
export function* replayRows(value) {
  for (let index = 0, length = replayRowCount(value); index < length; index++)
    yield replayRowAt(value, index);
}
export function mapReplayRows(value, callback) {
  return Array.from(replayRows(value), callback);
}
export function compactReplayReport(report) {
  return {
    ...report,
    effectDescriptors: packReplayRows(report.effectDescriptors),
    visibilityRequests: packReplayRows(report.visibilityRequests),
  };
}
export function ownReplayRows(value) {
  if (Array.isArray(value)) return packReplayRows(value);
  validate(value);
  const owned = structuredClone(value);
  validate(owned);
  return owned;
}
export function replayColumnTransfers(value) {
  const buffers = new Set();
  const visit = (entry) => {
    if (entry instanceof ArrayBuffer) {
      buffers.add(entry);
      return;
    }
    if (ArrayBuffer.isView(entry)) {
      buffers.add(entry.buffer);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (entry && typeof entry === "object")
      for (const item of Object.values(entry)) visit(item);
  };
  visit(value);
  return [...buffers];
}
