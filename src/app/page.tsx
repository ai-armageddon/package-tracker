'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface TrackingItem {
  id: string;
  trackingNumber: string;
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

export default function HomePage() {
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ trackingNumber: '', title: '', note: '' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', note: '' });

  const fetchItems = useCallback(async () => {
    const res = await fetch('/api/trackings');
    const data = await res.json();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

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
      setForm({ trackingNumber: '', title: '', note: '' });
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
    await fetch('/api/check', { method: 'POST' });
    setTimeout(() => {
      setChecking(false);
      fetchItems();
    }, 2000);
  }

  return (
    <div className="space-y-8">
      {/* Add Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Add Tracking Number</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Tracking number *"
              value={form.trackingNumber}
              onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium transition"
          >
            {adding ? 'Adding...' : 'Add Tracking'}
          </button>
        </form>
      </div>

      {/* Check Now Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Tracked Packages ({items.length})
        </h2>
        <button
          onClick={handleCheck}
          disabled={checking}
          className="bg-green-700 hover:bg-green-800 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium transition"
        >
          {checking ? 'Checking...' : 'Check Now'}
        </button>
      </div>

      {/* Items List */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500">
          No tracking numbers yet. Add one above.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`bg-gray-900 border rounded-lg p-5 transition ${
                item.active ? 'border-gray-700' : 'border-gray-800 opacity-50'
              }`}
            >
              {editId === item.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) =>
                      setEditForm({ ...editForm, title: e.target.value })
                    }
                    placeholder="Title"
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full"
                  />
                  <input
                    type="text"
                    value={editForm.note}
                    onChange={(e) =>
                      setEditForm({ ...editForm, note: e.target.value })
                    }
                    placeholder="Note"
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-xs"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs"
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
                        <h3 className="font-semibold">
                          {item.title || item.trackingNumber}
                        </h3>
                        {item.title && (
                          <code className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">
                            {item.trackingNumber}
                          </code>
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
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/history/${item.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        History
                      </Link>
                      <button
                        onClick={() => startEdit(item)}
                        className="text-xs text-gray-400 hover:text-gray-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(item)}
                        className={`text-xs ${
                          item.active
                            ? 'text-yellow-400 hover:text-yellow-300'
                            : 'text-green-400 hover:text-green-300'
                        }`}
                      >
                        {item.active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
