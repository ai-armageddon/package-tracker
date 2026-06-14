import { normalizeTrackingNumber, resolveCarrier, type Carrier } from "./carriers";

export interface BulkTrackingDraft {
  trackingNumber: string;
  carrier?: string;
  title?: string;
  note?: string;
  sourceLine?: number;
  raw?: string;
}

export interface BulkTrackingParseIssue {
  row: number;
  message: string;
  raw?: string;
}

export interface BulkTrackingParseResult {
  items: BulkTrackingDraft[];
  issues: BulkTrackingParseIssue[];
}

const TRACKING_KEYS = [
  "trackingnumber",
  "trackingno",
  "trackingid",
  "tracking",
  "number",
  "tn",
  "code",
];
const CARRIER_KEYS = ["carrier", "provider", "service", "shipper"];
const TITLE_KEYS = ["title", "name", "label", "package"];
const NOTE_KEYS = ["note", "notes", "description", "desc", "details"];
const COLLECTION_KEYS = [
  "trackings",
  "trackingnumbers",
  "trackingitems",
  "packages",
  "items",
  "data",
];

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyOptional(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(record).map(([key, value]) => [
    normalizeKey(key),
    value,
  ] as const);

  for (const key of keys) {
    const match = entries.find(([entryKey]) => entryKey === key);
    const value = match ? stringifyOptional(match[1]) : undefined;
    if (value) return value;
  }

  return undefined;
}

function parseCarrierLabel(value: string | undefined): Carrier | null {
  if (!value) return null;
  return resolveCarrier(value, "");
}

function draftFromRecord(
  record: Record<string, unknown>,
  row: number,
): BulkTrackingDraft | null {
  const trackingNumber = pickString(record, TRACKING_KEYS);
  if (!trackingNumber) return null;

  return {
    trackingNumber,
    carrier: pickString(record, CARRIER_KEYS),
    title: pickString(record, TITLE_KEYS),
    note: pickString(record, NOTE_KEYS),
    sourceLine: row,
  };
}

function draftFromJsonValue(value: unknown, row: number): BulkTrackingDraft | null {
  const directValue = stringifyOptional(value);
  if (directValue && typeof value !== "object") {
    return { trackingNumber: directValue, sourceLine: row };
  }

  if (!isRecord(value)) return null;
  return draftFromRecord(value, row);
}

function findJsonCollection(value: Record<string, unknown>): unknown[] | null {
  const entries = Object.entries(value).map(([key, entryValue]) => [
    normalizeKey(key),
    entryValue,
  ] as const);

  for (const key of COLLECTION_KEYS) {
    const match = entries.find(([entryKey]) => entryKey === key);
    if (Array.isArray(match?.[1])) return match[1];
  }

  return null;
}

function parseJsonValue(value: unknown): BulkTrackingParseResult {
  const items: BulkTrackingDraft[] = [];
  const issues: BulkTrackingParseIssue[] = [];

  const collection = Array.isArray(value)
    ? value
    : isRecord(value)
      ? findJsonCollection(value)
      : null;

  if (collection) {
    collection.forEach((entry, index) => {
      const row = index + 1;
      const draft = draftFromJsonValue(entry, row);
      if (draft) {
        items.push(draft);
      } else {
        issues.push({
          row,
          message: "Missing tracking number",
          raw: JSON.stringify(entry),
        });
      }
    });
    return { items, issues };
  }

  const singleDraft = draftFromJsonValue(value, 1);
  if (singleDraft) return { items: [singleDraft], issues };

  return {
    items,
    issues: [{ row: 1, message: "Could not find tracking entries" }],
  };
}

function detectDelimiter(lines: string[]) {
  const sample = lines.find((line) => /[\t|,]/.test(line));
  if (!sample) return null;
  if (sample.includes("\t")) return "\t";
  if (sample.includes("|")) return "|";
  return ",";
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function isHeaderRow(cells: string[]) {
  const keys = cells.map(normalizeKey);
  return keys.some((key) =>
    [...TRACKING_KEYS, ...CARRIER_KEYS, ...TITLE_KEYS, ...NOTE_KEYS].includes(
      key,
    ),
  );
}

function cellsToRecord(headers: string[], cells: string[]) {
  return headers.reduce<Record<string, string>>((record, header, index) => {
    const key = header.trim();
    if (key) record[key] = cells[index] || "";
    return record;
  }, {});
}

function draftFromDelimitedCells(
  cells: string[],
  row: number,
  raw: string,
): BulkTrackingDraft | null {
  const firstCarrier = parseCarrierLabel(cells[0]);
  const secondCarrier = parseCarrierLabel(cells[1]);
  const lastCarrier = parseCarrierLabel(cells[cells.length - 1]);

  if (firstCarrier && cells[1]) {
    return {
      trackingNumber: cells[1],
      carrier: firstCarrier,
      title: cells[2] || undefined,
      note: cells.slice(3).filter(Boolean).join(" ") || undefined,
      sourceLine: row,
      raw,
    };
  }

  if (secondCarrier && cells[0]) {
    return {
      trackingNumber: cells[0],
      carrier: secondCarrier,
      title: cells[2] || undefined,
      note: cells.slice(3).filter(Boolean).join(" ") || undefined,
      sourceLine: row,
      raw,
    };
  }

  if (lastCarrier && cells.length > 1 && cells[0]) {
    return {
      trackingNumber: cells[0],
      carrier: lastCarrier,
      title: cells[1] || undefined,
      note: cells.slice(2, -1).filter(Boolean).join(" ") || undefined,
      sourceLine: row,
      raw,
    };
  }

  if (!cells[0]) return null;

  return {
    trackingNumber: cells[0],
    title: cells[1] || undefined,
    note: cells.slice(2).filter(Boolean).join(" ") || undefined,
    sourceLine: row,
    raw,
  };
}

function draftFromPlainLine(rawLine: string, row: number): BulkTrackingDraft | null {
  const line = rawLine.trim().replace(/^[-*]\s+/, "");
  if (!line) return null;

  const parts = line.split(/\s+/);
  const firstCarrier = parseCarrierLabel(parts[0]);
  const lastCarrier = parseCarrierLabel(parts[parts.length - 1]);

  if (firstCarrier && parts.length > 1) {
    return {
      trackingNumber: parts.slice(1).join(""),
      carrier: firstCarrier,
      sourceLine: row,
      raw: rawLine,
    };
  }

  if (lastCarrier && parts.length > 1) {
    return {
      trackingNumber: parts.slice(0, -1).join(""),
      carrier: lastCarrier,
      sourceLine: row,
      raw: rawLine,
    };
  }

  return {
    trackingNumber: line,
    sourceLine: row,
    raw: rawLine,
  };
}

function parseTextInput(input: string): BulkTrackingParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line, index) => ({ line, row: index + 1 }))
    .filter(({ line }) => line.trim());
  const items: BulkTrackingDraft[] = [];
  const issues: BulkTrackingParseIssue[] = [];
  const delimiter = detectDelimiter(lines.map(({ line }) => line));

  if (!delimiter) {
    lines.forEach(({ line, row }) => {
      const draft = draftFromPlainLine(line, row);
      if (draft) items.push(draft);
    });
    return { items, issues };
  }

  const rows = lines.map(({ line, row }) => ({
    line,
    row,
    cells: splitDelimitedLine(line, delimiter),
  }));
  const headers = rows.length > 0 && isHeaderRow(rows[0].cells)
    ? rows[0].cells
    : null;
  const dataRows = headers ? rows.slice(1) : rows;

  dataRows.forEach(({ line, row, cells }) => {
    const draft = headers
      ? draftFromRecord(cellsToRecord(headers, cells), row)
      : draftFromDelimitedCells(cells, row, line);

    if (draft) {
      items.push({ ...draft, raw: line });
    } else {
      issues.push({ row, message: "Missing tracking number", raw: line });
    }
  });

  return { items, issues };
}

export function parseBulkTrackingValue(value: unknown): BulkTrackingParseResult {
  if (typeof value === "string") return parseBulkTrackingInput(value);
  return parseJsonValue(value);
}

export function parseBulkTrackingItems(items: unknown[]): BulkTrackingParseResult {
  return parseJsonValue(items);
}

export function parseBulkTrackingInput(input: string): BulkTrackingParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      items: [],
      issues: [{ row: 1, message: "Paste or upload at least one tracking number" }],
    };
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return parseJsonValue(JSON.parse(trimmed));
    } catch {
      return {
        items: [],
        issues: [{ row: 1, message: "Invalid JSON format" }],
      };
    }
  }

  const parsed = parseTextInput(input);
  parsed.items = parsed.items.map((item) => ({
    ...item,
    trackingNumber: normalizeTrackingNumber(item.trackingNumber)
      ? item.trackingNumber
      : "",
  }));

  return parsed;
}
