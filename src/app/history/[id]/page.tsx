'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface StatusEvent {
  id: string;
  status: string;
  detail: string;
  location: string | null;
  eventDate: string;
  eventTime: string;
  createdAt: string;
}

interface TrackingWithHistory {
  id: string;
  trackingNumber: string;
  title: string | null;
  note: string | null;
  lastStatus: string | null;
  lastStatusDate: string | null;
  lastDetail: string | null;
  lastLocation: string | null;
  active: boolean;
  statusHistory: StatusEvent[];
}

export default function HistoryPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<TrackingWithHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    fetch(`/api/trackings/${params.id}/history`)
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          router.push('/');
        } else {
          setData(d);
        }
        setLoading(false);
        setTimeout(() => setMounted(true), 50);
      });
  }, [params.id, router]);

  if (loading)
    return (
      <div className="flex items-center gap-3 text-gray-500">
        <span className="w-4 h-4 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
        Loading...
      </div>
    );
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div
        className={`flex items-center gap-4 transition-all duration-500 ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`}
      >
        <button
          onClick={() => router.push('/')}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          &larr; Back
        </button>
        <div>
          <h2 className="text-xl font-bold">
            {data.title || data.trackingNumber}
          </h2>
          {data.title && (
            <code className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">
              {data.trackingNumber}
            </code>
          )}
          {data.note && (
            <p className="text-sm text-gray-500 mt-1">{data.note}</p>
          )}
        </div>
      </div>

      {data.statusHistory.length === 0 ? (
        <p className="text-gray-500 animate-fade-in">
          No status events recorded yet.
        </p>
      ) : (
        <div className="relative pl-6 border-l border-gray-800 space-y-6">
          {data.statusHistory.map((event, i) => (
            <div
              key={event.id}
              className="relative"
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(8px)',
                transitionDelay: `${i * 80}ms`,
                transitionDuration: '400ms',
                transitionProperty: 'opacity, transform',
                transitionTimingFunction: 'ease-out',
              }}
            >
              <div
                className={`absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full border-2 transition-all duration-500 ${
                  i === 0
                    ? 'bg-blue-500 border-blue-500 animate-pulse-subtle'
                    : 'bg-gray-800 border-gray-600'
                }`}
              />
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 transition-colors hover:border-gray-700">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="font-medium text-blue-400">
                      {event.status}
                    </span>
                    <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">
                      {event.detail}
                    </p>
                    {event.location && (
                      <p className="text-xs text-gray-600 mt-1">
                        {event.location}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 text-right shrink-0">
                    <div>{event.eventDate}</div>
                    <div>{event.eventTime}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
