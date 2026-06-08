'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

const TRACKING_URLS: Record<string, (tn: string) => string> = {
  USPS: (tn) => `https://tools.usps.com/tracking/${encodeURIComponent(tn)}`,
  FedEx: (tn) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`,
};

function detectCarrier(tn: string): string | null {
  const cleaned = tn.trim();
  if (/^\d{20,22}$/.test(cleaned)) return 'USPS';
  if (/^\d{12,22}$/.test(cleaned) || /^DT\d{12}$/i.test(cleaned.toUpperCase())) return 'FedEx';
  return null;
}

function carrierBadge(carrier: string) {
  const colors: Record<string, string> = {
    USPS: 'bg-blue-900/40 text-blue-400 border-blue-800',
    FedEx: 'bg-purple-900/40 text-purple-400 border-purple-800',
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider ${
        colors[carrier] || 'bg-gray-800 text-gray-400 border-gray-700'
      }`}
    >
      {carrier}
    </span>
  );
}

function carrierCardStyle(carrier: string) {
  switch (carrier) {
    case 'USPS':
      return 'border-l-blue-500/50 bg-gradient-to-r from-blue-600/15 via-blue-500/5 to-transparent';
    case 'FedEx':
      return 'border-l-purple-500/50 bg-gradient-to-r from-purple-600/15 via-purple-500/5 to-transparent';
    default:
      return 'border-l-gray-600';
  }
}

function carrierGradientAnim(carrier: string) {
  switch (carrier) {
    case 'USPS':
      return 'animate-gradient-usps';
    case 'FedEx':
      return 'animate-gradient-fedex';
    default:
      return '';
  }
}

export default function HomePage() {
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ trackingNumber: '', carrier: 'USPS', title: '', note: '' });
  const [detectedCarrier, setDetectedCarrier] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', note: '' });
  const [mounted, setMounted] = useState(false);

  const fetchItems = useCallback(async () => {
    const res = await fetch('/api/trackings');
    const data = await res.json();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
    setTimeout(() => setMounted(true), 50);
  }, [fetchItems]);

  function handleTrackingChange(value: string) {
    const detected = detectCarrier(value);
    setDetectedCarrier(detected);
    setForm((prev) => ({
      ...prev,
      trackingNumber: value,
      carrier: detected || prev.carrier,
    }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.trackingNumber.trim()) return;

    setAdding(true);
    const res = await fetch('/api/trackings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Failed to add');
    } else {
      setForm({ trackingNumber: '', carrier: 'USPS', title: '', note: '' });
      setDetectedCarrier(null);
      fetchItems();
    }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/trackings/${id}`, { method: 'DELETE' });
    fetchItems();
  }

  async function handleToggle(item: TrackingItem) {
    await fetch(`/api/trackings/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !item.active }),
    });
    fetchItems();
  }

  function startEdit(item: TrackingItem) {
    setEditId(item.id);
    setEditForm({ title: item.title || '', note: item.note || '' });
  }

  async function handleSaveEdit() {
    if (!editId) return;
    await fetch(`/api/trackings/${editId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditId(null);
    fetchItems();
  }

  async function handleCheck() {
    setChecking(true);
    const activeIds = new Set(items.filter((i) => i.active).map((i) => i.id));
    setCheckingIds(activeIds);
    await fetch('/api/check', { method: 'POST' });
    setTimeout(() => {
      setChecking(false);
      setCheckingIds(new Set());
      fetchItems();
    }, 2000);
  }

  async function handleCheckItem(id: string) {
    setCheckingIds((prev) => new Set(prev).add(id));
    await fetch(`/api/trackings/${id}/check`, { method: 'POST' });
    setTimeout(() => {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchItems();
    }, 1000);
  }

  return (
    <div className="space-y-8">
      <div className={`bg-gray-900 border border-gray-800 rounded-lg p-6 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <h2 className="text-lg font-semibold mb-4">Add Tracking Number</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder="Tracking number *"
              value={form.trackingNumber}
              onChange={(e) => handleTrackingChange(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
            />
            <input
              type="text"
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
            />
            <div className="sm:col-span-4">
              {form.trackingNumber && (
                <div className="flex items-center gap-3 animate-fade-in flex-wrap">
                  <span className="text-sm text-gray-400">Carrier:</span>
                  <select
                    value={form.carrier}
                    onChange={(e) => setForm({ ...form, carrier: e.target.value })}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200"
                  >
                    <option value="USPS">USPS</option>
                    <option value="FedEx">FedEx</option>
                  </select>
                  {detectedCarrier && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider whitespace-nowrap ${
                      detectedCarrier === 'USPS'
                        ? 'bg-blue-900/20 text-blue-400/60 border-blue-800/40'
                        : 'bg-purple-900/20 text-purple-400/60 border-purple-800/40'
                    }`}>
                      {detectedCarrier === form.carrier ? 'auto' : 'mismatch'}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {form.carrier === 'USPS' ? '20-22 digits' : '12+ digits'}
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
              'Add Tracking'
            )}
          </button>
        </form>
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
            'Check Now'
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
            return (
            <div
              key={item.id}
              className={`bg-gray-900 border border-l-2 rounded-lg p-5 transition-all duration-300 hover:border-gray-500 ${
                item.active ? 'border-gray-700' : 'border-gray-800 opacity-50'
              } ${isChecked ? 'ring-1 ring-green-500/30 border-green-600/40' : ''} ${carrierCardStyle(item.carrier)} ${carrierGradientAnim(item.carrier)}`}
              style={{
                backgroundSize: '200% 100%',
                opacity: mounted ? (item.active ? 1 : 0.5) : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(12px)',
                transitionDelay: `${i * 60}ms`,
                transitionDuration: '400ms',
                transitionProperty: 'opacity, transform',
                transitionTimingFunction: 'ease-out',
              }}
            >
              {editId === item.id ? (
                <div className="space-y-3 animate-scale-in">
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) =>
                      setEditForm({ ...editForm, title: e.target.value })
                    }
                    placeholder="Title"
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <input
                    type="text"
                    value={editForm.note}
                    onChange={(e) =>
                      setEditForm({ ...editForm, note: e.target.value })
                    }
                    placeholder="Note"
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-blue-500 transition-colors"
                  />
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
                        {carrierBadge(item.carrier)}
                        <h3 className="font-semibold">
                          <a
                            href={(TRACKING_URLS[item.carrier] || TRACKING_URLS.USPS)(item.trackingNumber)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-blue-400 transition-colors"
                          >
                            {item.title || item.trackingNumber}
                          </a>
                        </h3>
                        {item.title && (
                          <a
                            href={(TRACKING_URLS[item.carrier] || TRACKING_URLS.USPS)(item.trackingNumber)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-0.5 rounded text-gray-400 hover:text-blue-300 transition-colors underline decoration-gray-600 hover:decoration-blue-400"
                          >
                            {item.trackingNumber}
                          </a>
                        )}
                      </div>
                      {item.note && (
                        <p className="text-sm text-gray-500 mt-1">{item.note}</p>
                      )}
                      {item.lastStatus && (
                        <div className="mt-2 text-sm">
                          <span className="text-blue-400 font-medium">
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
                          {new Date(item.lastStatusDate).toLocaleDateString()}{' '}
                          {new Date(item.lastStatusDate).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                      {isChecked && (
                        <div className="flex items-center gap-2 mt-2 text-green-400 animate-fade-in">
                          <span className="w-3 h-3 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                          <span className="text-xs font-medium">Checking...</span>
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
                            ? 'text-green-400'
                            : 'text-green-500 hover:text-green-400'
                        }`}
                      >
                        {isChecked ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                          </span>
                        ) : (
                          'Check'
                        )}
                      </button>
                      <button
                        onClick={() => handleToggle(item)}
                        className={`text-xs transition-colors ${
                          item.active
                            ? 'text-yellow-400 hover:text-yellow-300'
                            : 'text-green-400 hover:text-green-300'
                        }`}
                      >
                        {item.active ? 'Pause' : 'Resume'}
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
  );
}
