"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  CARRIERS,
  detectCarrier,
  normalizeTrackingNumber,
  type Carrier,
} from "@/lib/services/carriers";
import {
  CarrierBadge,
  CarrierLogo,
  getCarrierHref,
  getCarrierTheme,
} from "@/components/carrier-brand";

interface TrackingItem {
  id: string;
  trackingNumber: string;
  carrier: string;
  title: string | null;
  note: string | null;
  lastStatus: string | null;
  lastStatusDate: string | null;
  lastDetail: string | null;
  lastLocation: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BulkImportIssue {
  row: number;
  message: string;
  raw?: string;
}

interface BulkImportResult {
  row: number;
  status: "created" | "skipped" | "failed";
  trackingNumber: string;
  carrier: string | null;
  error?: string;
}

interface BulkImportResponse {
  imported: number;
  skipped: number;
  failed: number;
  parseIssues: BulkImportIssue[];
  results: BulkImportResult[];
}

const DEFAULT_CARRIER: Carrier = "USPS";
const MAX_BULK_FILE_SIZE = 1024 * 1024;
const BULK_FILE_EXTENSIONS = [".json", ".txt"];
const NOTE_TEXTAREA_MIN_HEIGHT = 42;
const NOTE_TEXTAREA_MAX_HEIGHT = 160;

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex).toLowerCase();
}

function dataTransferHasFiles(dataTransfer: DataTransfer | null) {
  return Array.from(dataTransfer?.types || []).includes("Files");
}

function isEditablePasteTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function looksLikeTrackingPaste(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (
    /^[\[{]/.test(trimmed) &&
    /(tracking|carrier|package|items|data|1z|dt\s*-?\s*\d{4}|(?:\d[\s-]?){12})/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  const upper = trimmed.toUpperCase();
  return [
    /1Z[0-9A-Z\s-]{16,24}/,
    /DT[\s-]?\d{12}/,
    /T[\s-]?\d{10}/,
    /MI[0-9A-Z\s-]{7,28}/,
    /(?:\d[\s-]?){12,22}/,
  ].some((pattern) => pattern.test(upper));
}

function resizeAutoTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;

  element.style.height = "auto";
  const nextHeight = Math.min(
    Math.max(element.scrollHeight, NOTE_TEXTAREA_MIN_HEIGHT),
    NOTE_TEXTAREA_MAX_HEIGHT,
  );
  element.style.height = `${nextHeight}px`;
  element.style.overflowY =
    element.scrollHeight > NOTE_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
}

function validateBulkFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!BULK_FILE_EXTENSIONS.includes(extension)) {
    return "Use a .txt or .json file.";
  }

  if (file.size === 0) {
    return "File is empty.";
  }

  if (file.size > MAX_BULK_FILE_SIZE) {
    return "File is too large. Keep imports under 1 MB.";
  }

  return null;
}

function validateBulkFileText(file: File, text: string) {
  const extension = getFileExtension(file.name);

  if (!text.trim()) {
    return "File is empty.";
  }

  if (text.includes("\u0000")) {
    return "File does not look like text.";
  }

  if (extension === ".json") {
    try {
      JSON.parse(text);
    } catch {
      return "JSON file is not valid.";
    }
  }

  return null;
}

function detectCarrierForInput(tn: string): Carrier | null {
  const cleaned = normalizeTrackingNumber(tn);
  if (!cleaned) return null;

  if (
    /^1Z[0-9A-Z]{0,16}$/.test(cleaned) ||
    /^T\d{0,10}$/.test(cleaned) ||
    /^\d{9}$/.test(cleaned) ||
    /^\d{12}$/.test(cleaned) ||
    /^MI[0-9A-Z]{0,28}$/.test(cleaned)
  ) {
    return "UPS";
  }

  return detectCarrier(cleaned);
}

function handleUnauthorized(res: Response) {
  if (res.status !== 401) return false;

  window.location.href = "/login";
  return true;
}

export default function HomePage() {
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    trackingNumber: "",
    carrier: DEFAULT_CARRIER,
    title: "",
    note: "",
  });
  const [detectedCarrier, setDetectedCarrier] = useState<Carrier | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkDragActive, setBulkDragActive] = useState(false);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkImportResponse | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", note: "" });
  const [mounted, setMounted] = useState(false);
  const bulkDragDepth = useRef(0);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editNoteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchItems = useCallback(async () => {
    const res = await fetch("/api/trackings");
    if (handleUnauthorized(res)) return;

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load tracking numbers");
      setItems([]);
      setLoading(false);
      return;
    }

    setItems(data);
    setLoading(false);
  }, []);

  const loadBulkText = useCallback((text: string, sourceName: string) => {
    setBulkOpen(true);
    setBulkError("");
    setBulkMessage(`${sourceName} ready`);
    setBulkResults(null);
    setBulkFileName(sourceName);
    setBulkInput(text);
  }, []);

  const loadBulkFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;

    setBulkOpen(true);
    setBulkError("");
    setBulkMessage("");
    setBulkResults(null);
    setBulkFileName(file.name);

    const fileError = validateBulkFile(file);
    if (fileError) {
      setBulkError(fileError);
      return;
    }

    let text = "";
    try {
      text = await file.text();
    } catch {
      setBulkError("Could not read that file.");
      return;
    }

    const textError = validateBulkFileText(file, text);
    if (textError) {
      setBulkError(textError);
      return;
    }

    loadBulkText(text, file.name);
  }, [loadBulkText]);

  useEffect(() => {
    fetchItems();
    setTimeout(() => setMounted(true), 50);
  }, [fetchItems]);

  useEffect(() => {
    resizeAutoTextarea(noteTextareaRef.current);
  }, [form.note]);

  useEffect(() => {
    if (editId) resizeAutoTextarea(editNoteTextareaRef.current);
  }, [editId, editForm.note]);

  useEffect(() => {
    function handleWindowDragEnter(event: DragEvent) {
      if (!dataTransferHasFiles(event.dataTransfer)) return;

      event.preventDefault();
      bulkDragDepth.current += 1;
      setBulkOpen(true);
      setBulkDragActive(true);
    }

    function handleWindowDragOver(event: DragEvent) {
      if (!dataTransferHasFiles(event.dataTransfer)) return;

      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setBulkDragActive(true);
    }

    function handleWindowDragLeave(event: DragEvent) {
      if (!dataTransferHasFiles(event.dataTransfer)) return;

      bulkDragDepth.current = Math.max(0, bulkDragDepth.current - 1);
      if (bulkDragDepth.current === 0) setBulkDragActive(false);
    }

    function handleWindowDrop(event: DragEvent) {
      if (!dataTransferHasFiles(event.dataTransfer)) return;

      event.preventDefault();
      bulkDragDepth.current = 0;
      setBulkDragActive(false);

      const files = event.dataTransfer?.files;
      if (!files?.length) return;

      if (files.length > 1) {
        setBulkOpen(true);
        setBulkMessage("");
        setBulkResults(null);
        setBulkError("Drop one .txt or .json file at a time.");
        return;
      }

      void loadBulkFile(files.item(0));
    }

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [loadBulkFile]);

  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      if (isEditablePasteTarget(event.target)) return;

      const text = event.clipboardData?.getData("text/plain") || "";
      if (!looksLikeTrackingPaste(text)) return;

      event.preventDefault();
      loadBulkText(text, "Clipboard paste");
    }

    window.addEventListener("paste", handleWindowPaste);

    return () => {
      window.removeEventListener("paste", handleWindowPaste);
    };
  }, [loadBulkText]);

  function handleTrackingChange(value: string) {
    const detected = detectCarrierForInput(value);
    setDetectedCarrier(detected);
    setForm((prev) => ({
      ...prev,
      trackingNumber: value,
      carrier: detected || prev.carrier,
    }));
  }

  function upsertItem(item: TrackingItem) {
    setItems((prev) => {
      const existingIndex = prev.findIndex((current) => current.id === item.id);
      if (existingIndex === -1) return [item, ...prev];

      const next = [...prev];
      next[existingIndex] = item;
      return next;
    });
  }

  async function runItemCheck(id: string, minVisibleMs = 1000) {
    const startedAt = Date.now();
    setCheckingIds((prev) => new Set(prev).add(id));

    try {
      const res = await fetch(`/api/trackings/${id}/check`, { method: "POST" });
      if (handleUnauthorized(res)) return;

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to check tracking number");
        return;
      }

      if (data?.id) {
        upsertItem(data);
      } else {
        fetchItems();
      }
    } finally {
      const remainingMs = Math.max(0, minVisibleMs - (Date.now() - startedAt));
      setTimeout(() => {
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, remainingMs);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.trackingNumber.trim()) return;

    setAdding(true);
    const res = await fetch("/api/trackings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (handleUnauthorized(res)) {
      setAdding(false);
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to add");
    } else {
      upsertItem(data);
      setForm({
        trackingNumber: "",
        carrier: DEFAULT_CARRIER,
        title: "",
        note: "",
      });
      setDetectedCarrier(null);
      void runItemCheck(data.id);
    }
    setAdding(false);
  }

  function getBulkSummary(data: BulkImportResponse) {
    const parts: string[] = [];
    if (data.imported) parts.push(`Imported ${data.imported}`);
    if (data.skipped) parts.push(`Skipped ${data.skipped}`);
    if (data.failed) parts.push(`Needs review ${data.failed}`);
    return parts.join(", ") || "No tracking numbers imported";
  }

  async function handleBulkImport(e: React.FormEvent) {
    e.preventDefault();
    setBulkError("");
    setBulkMessage("");
    setBulkResults(null);

    if (!bulkInput.trim()) {
      setBulkError("Paste tracking numbers or choose a file first.");
      return;
    }

    setBulkImporting(true);
    const res = await fetch("/api/trackings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: bulkInput }),
    });
    if (handleUnauthorized(res)) {
      setBulkImporting(false);
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      setBulkResults(data.results ? data : null);
      setBulkError(
        data.error || data.parseIssues?.[0]?.message || "Bulk import failed",
      );
    } else {
      setBulkResults(data);
      setBulkMessage(getBulkSummary(data));
      if (data.imported > 0) fetchItems();
      if (data.imported > 0 && data.skipped === 0 && data.failed === 0) {
        setBulkInput("");
        setBulkFileName("");
      }
    }

    setBulkImporting(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/trackings/${id}`, { method: "DELETE" });
    if (handleUnauthorized(res)) return;

    fetchItems();
  }

  async function handleToggle(item: TrackingItem) {
    const res = await fetch(`/api/trackings/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !item.active }),
    });
    if (handleUnauthorized(res)) return;

    fetchItems();
  }

  function startEdit(item: TrackingItem) {
    setEditId(item.id);
    setEditForm({ title: item.title || "", note: item.note || "" });
  }

  async function handleSaveEdit() {
    if (!editId) return;
    const res = await fetch(`/api/trackings/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    if (handleUnauthorized(res)) return;

    setEditId(null);
    fetchItems();
  }

  async function handleCheck() {
    setChecking(true);
    const activeIds = new Set(items.filter((i) => i.active).map((i) => i.id));
    setCheckingIds(activeIds);
    const res = await fetch("/api/check", { method: "POST" });
    if (handleUnauthorized(res)) return;

    setTimeout(() => {
      setChecking(false);
      setCheckingIds(new Set());
      fetchItems();
    }, 2000);
  }

  async function handleCheckItem(id: string) {
    await runItemCheck(id);
  }

  const formCarrierTheme = getCarrierTheme(form.carrier);
  const bulkLineCount = bulkInput
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  const bulkProblemRows = bulkResults
    ? [
        ...bulkResults.results
          .filter((result) => result.status !== "created")
          .map((result) => ({
            key: `result-${result.row}-${result.trackingNumber}`,
            row: result.row,
            label: result.status === "skipped" ? "Skipped" : "Failed",
            detail: result.error || result.trackingNumber,
          })),
        ...bulkResults.parseIssues.map((issue) => ({
          key: `issue-${issue.row}-${issue.message}`,
          row: issue.row,
          label: "Parse",
          detail: issue.message,
        })),
      ].slice(0, 6)
    : [];

  return (
    <>
      {bulkDragActive && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-gray-950/70 px-4 backdrop-blur-sm">
          <div className="rounded-lg border border-blue-400 bg-gray-900 px-5 py-4 text-center shadow-2xl shadow-blue-950/40">
            <p className="text-sm font-semibold text-blue-200">
              Drop TXT or JSON
            </p>
          </div>
        </div>
      )}
      <div className="space-y-8">
      <div
        className={`bg-gray-900 border border-gray-800 rounded-lg p-6 transition-all duration-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Add Tracking Number</h2>
          <button
            type="button"
            aria-controls="bulk-import-menu"
            aria-expanded={bulkOpen}
            onClick={() => setBulkOpen((open) => !open)}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
          >
            {bulkOpen ? "Close Import" : "Import"}
          </button>
        </div>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <label className="block sm:col-span-2">
              <span className="block text-xs font-medium text-gray-400">
                Tracking number *
              </span>
              <input
                type="text"
                value={form.trackingNumber}
                onChange={(e) => handleTrackingChange(e.target.value)}
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-xs font-medium text-gray-400">
                Title (optional)
              </span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
              />
            </label>
            <label className="block sm:col-span-4">
              <span className="block text-xs font-medium text-gray-400">
                Note (optional)
              </span>
              <textarea
                ref={noteTextareaRef}
                value={form.note}
                rows={1}
                style={{
                  minHeight: NOTE_TEXTAREA_MIN_HEIGHT,
                  maxHeight: NOTE_TEXTAREA_MAX_HEIGHT,
                }}
                onChange={(e) => {
                  setForm({ ...form, note: e.target.value });
                  resizeAutoTextarea(e.currentTarget);
                }}
                className="mt-1 w-full resize-none bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
              />
            </label>
            <div className="sm:col-span-4">
              {form.trackingNumber && (
                <div className="flex items-center gap-3 animate-fade-in flex-wrap">
                  <span className="text-sm text-gray-400">Carrier:</span>
                  <div className="inline-flex items-center gap-2 rounded border border-gray-700 bg-gray-800 pl-2 transition-colors duration-200 focus-within:border-blue-500">
                    <CarrierLogo
                      carrier={form.carrier}
                      className="carrier-logo-select"
                    />
                    <select
                      value={form.carrier}
                      onChange={(e) =>
                        setForm({ ...form, carrier: e.target.value as Carrier })
                      }
                      className="bg-transparent py-2 pl-1 pr-3 text-sm focus:outline-none"
                    >
                      {CARRIERS.map((carrier) => (
                        <option key={carrier} value={carrier}>
                          {carrier}
                        </option>
                      ))}
                    </select>
                  </div>
                  {detectedCarrier && (
                    <span
                      aria-live="polite"
                      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${getCarrierTheme(detectedCarrier).detectedClass}`}
                    >
                      <CarrierLogo
                        carrier={detectedCarrier}
                        className="carrier-badge-logo"
                      />
                      {detectedCarrier === form.carrier
                        ? `Auto-detected ${detectedCarrier}`
                        : `Detected ${detectedCarrier}`}
                    </span>
                  )}
                  <span className="text-xs text-gray-500 leading-snug">
                    {formCarrierTheme.formatHint}
                  </span>
                </div>
              )}
            </div>
          </div>
          {error && (
            <p className="text-red-400 text-sm animate-fade-in">{error}</p>
          )}
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium transition-all duration-200"
          >
            {adding ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Adding...
              </span>
            ) : (
              "Add Tracking"
            )}
          </button>
        </form>

        {bulkOpen && (
          <div
            id="bulk-import-menu"
            className="mt-5 rounded-lg border border-gray-800 bg-gray-950/55 p-4 shadow-xl animate-fade-in"
          >
            <form onSubmit={handleBulkImport} className="space-y-4">
              <div
                className={`rounded border border-dashed p-3 transition-colors ${
                  bulkDragActive
                    ? "border-blue-400 bg-blue-500/10"
                    : "border-gray-700 bg-gray-900/60"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-200">
                      {bulkFileName || "TXT / JSON"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {bulkLineCount > 0
                        ? `${bulkLineCount} lines loaded`
                        : "Drop file here"}
                    </p>
                  </div>
                  <label
                    htmlFor="bulk-import-file"
                    className="cursor-pointer rounded bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-700"
                  >
                    Choose
                  </label>
                  <input
                    id="bulk-import-file"
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    className="sr-only"
                    onChange={(e) => {
                      void loadBulkFile(e.target.files?.item(0));
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>

              <textarea
                value={bulkInput}
                onChange={(e) => {
                  setBulkInput(e.target.value);
                  setBulkFileName("");
                  setBulkError("");
                  setBulkMessage("");
                  setBulkResults(null);
                }}
                rows={5}
                aria-label="Bulk tracking import"
                placeholder={`Paste tracking numbers or JSON\n1Z999AA10123456784\n9400100000000000000000`}
                className="min-h-36 w-full resize-y rounded border border-gray-800 bg-gray-900 px-3 py-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={bulkImporting}
                  className="bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium transition-all duration-200"
                >
                  {bulkImporting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Importing...
                    </span>
                  ) : (
                    "Import"
                  )}
                </button>
                {bulkInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkInput("");
                      setBulkFileName("");
                      setBulkError("");
                      setBulkMessage("");
                      setBulkResults(null);
                    }}
                    className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
                  >
                    Clear
                  </button>
                )}
              </div>

              {bulkError && (
                <p className="text-red-400 text-sm animate-fade-in">
                  {bulkError}
                </p>
              )}
              {bulkMessage && (
                <p className="text-green-400 text-sm animate-fade-in">
                  {bulkMessage}
                </p>
              )}
              {bulkProblemRows.length > 0 && (
                <div className="rounded border border-gray-800 bg-gray-950/45 p-3 text-sm text-gray-400 animate-fade-in">
                  <div className="space-y-1.5">
                    {bulkProblemRows.map((row) => (
                      <p key={row.key} className="flex gap-2">
                        <span className="shrink-0 text-gray-500">
                          Row {row.row}
                        </span>
                        <span className="shrink-0 text-gray-300">
                          {row.label}
                        </span>
                        <span className="min-w-0 break-words">
                          {row.detail}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </form>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Tracked Packages ({items.length})
        </h2>
        <button
          onClick={handleCheck}
          disabled={checking}
          className="bg-green-700 hover:bg-green-800 active:scale-95 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium transition-all duration-200"
        >
          {checking ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Checking...
            </span>
          ) : (
            "Check Now"
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-gray-500">
          <span className="w-4 h-4 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
          Loading...
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-500 animate-fade-in">
          No tracking numbers yet. Add one above.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => {
            const isChecked = checkingIds.has(item.id);
            const itemTheme = getCarrierTheme(item.carrier);
            const itemHref = getCarrierHref(item.carrier, item.trackingNumber);
            return (
              <div
                key={item.id}
                className={`carrier-card bg-gray-900 border border-l-2 rounded-lg p-5 transition-all duration-300 hover:border-gray-500 ${
                  item.active ? "border-gray-700" : "border-gray-800 opacity-50"
                } ${isChecked ? "ring-1 ring-green-500/30 border-green-600/40" : ""} ${itemTheme.cardClass}`}
                style={{
                  opacity: mounted ? (item.active ? 1 : 0.5) : 0,
                  transform: mounted ? "translateY(0)" : "translateY(12px)",
                  transitionDelay: `${i * 60}ms`,
                  transitionDuration: "400ms",
                  transitionProperty: "opacity, transform",
                  transitionTimingFunction: "ease-out",
                }}
              >
                {editId === item.id ? (
                  <div className="space-y-3 animate-scale-in">
                    <label className="block">
                      <span className="block text-xs font-medium text-gray-400">
                        Title
                      </span>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) =>
                          setEditForm({ ...editForm, title: e.target.value })
                        }
                        className="mt-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium text-gray-400">
                        Note
                      </span>
                      <textarea
                        ref={editNoteTextareaRef}
                        value={editForm.note}
                        rows={1}
                        style={{
                          minHeight: NOTE_TEXTAREA_MIN_HEIGHT,
                          maxHeight: NOTE_TEXTAREA_MAX_HEIGHT,
                        }}
                        onChange={(e) => {
                          setEditForm({
                            ...editForm,
                            note: e.target.value,
                          });
                          resizeAutoTextarea(e.currentTarget);
                        }}
                        className="mt-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full resize-none focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEdit}
                        className="bg-blue-600 hover:bg-blue-700 active:scale-95 px-3 py-1 rounded text-xs transition-all duration-150"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="bg-gray-700 hover:bg-gray-600 active:scale-95 px-3 py-1 rounded text-xs transition-all duration-150"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <CarrierBadge carrier={item.carrier} />
                          <h3 className="font-semibold">
                            <a
                              href={itemHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-400 transition-colors"
                            >
                              {item.title || item.trackingNumber}
                            </a>
                          </h3>
                          {item.title && (
                            <a
                              href={itemHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-0.5 rounded text-gray-400 hover:text-blue-300 transition-colors underline decoration-gray-600 hover:decoration-blue-400"
                            >
                              {item.trackingNumber}
                            </a>
                          )}
                        </div>
                        {item.note && (
                          <p className="text-sm text-gray-500 mt-1">
                            {item.note}
                          </p>
                        )}
                        {item.lastStatus && (
                          <div className="mt-2 text-sm">
                            <span
                              className={`${itemTheme.statusTextClass} font-medium`}
                            >
                              {item.lastStatus}
                            </span>
                            {item.lastDetail && (
                              <span className="text-gray-500 ml-2">
                                — {item.lastDetail}
                              </span>
                            )}
                          </div>
                        )}
                        {item.lastLocation && (
                          <p className="text-xs text-gray-600 mt-0.5">
                            {item.lastLocation}
                          </p>
                        )}
                        {item.lastStatusDate && (
                          <p className="text-xs text-gray-600 mt-0.5">
                            {new Date(item.lastStatusDate).toLocaleDateString()}{" "}
                            {new Date(item.lastStatusDate).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        )}
                        {isChecked && (
                          <div className="flex items-center gap-2 mt-2 text-green-400 animate-fade-in">
                            <span className="w-3 h-3 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                            <span className="text-xs font-medium">
                              Checking...
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/history/${item.id}`}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          History
                        </Link>
                        <button
                          onClick={() => startEdit(item)}
                          className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleCheckItem(item.id)}
                          disabled={isChecked}
                          className={`text-xs transition-colors ${
                            isChecked
                              ? "text-green-400"
                              : "text-green-500 hover:text-green-400"
                          }`}
                        >
                          {isChecked ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2.5 h-2.5 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                            </span>
                          ) : (
                            "Check"
                          )}
                        </button>
                        <button
                          onClick={() => handleToggle(item)}
                          className={`text-xs transition-colors ${
                            item.active
                              ? "text-yellow-400 hover:text-yellow-300"
                              : "text-green-400 hover:text-green-300"
                          }`}
                        >
                          {item.active ? "Pause" : "Resume"}
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </>
  );
}
