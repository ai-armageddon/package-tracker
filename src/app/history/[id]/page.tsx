"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CarrierBadge,
  CarrierLogo,
  getCarrierTheme,
} from "@/components/carrier-brand";
import { StatusPill } from "@/components/status-pill";

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
  carrier: string;
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
      .then((res) => {
        if (res.status === 401) {
          router.push("/login");
          return null;
        }

        return res.json();
      })
      .then((d) => {
        if (!d) return;

        if (d.error) {
          router.push("/");
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

  const carrierTheme = getCarrierTheme(data.carrier);

  return (
    <div className="space-y-6">
      <div
        className={`flex items-center gap-4 transition-all duration-500 ${
          mounted ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
        }`}
      >
        <button
          onClick={() => router.push("/")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-800 bg-gray-900/70 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-100"
        >
          <span aria-hidden="true">&larr;</span> Back
        </button>
        <CarrierLogo carrier={data.carrier} className="carrier-logo-page" />
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold">
              {data.title || data.trackingNumber}
            </h2>
            <CarrierBadge carrier={data.carrier} />
          </div>
          {data.title && (
            <code className="mt-1 inline-block rounded-md border border-gray-700/60 bg-gray-800/70 px-1.5 py-0.5 font-mono text-[11px] text-gray-400">
              {data.trackingNumber}
            </code>
          )}
          {data.note && (
            <p className="text-sm text-gray-500 mt-1">{data.note}</p>
          )}
        </div>
      </div>

      {data.statusHistory.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center animate-fade-in">
          <div className="mb-3 text-3xl opacity-80">🚚</div>
          <p className="text-sm font-medium text-gray-300">
            No status events yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">
            Events will appear here the next time this package is checked.
          </p>
        </div>
      ) : (
        <div
          className={`relative pl-6 border-l ${carrierTheme.historyBorderClass} space-y-6`}
        >
          {data.statusHistory.map((event, i) => (
            <div
              key={event.id}
              className="relative"
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(8px)",
                transitionDelay: `${i * 80}ms`,
                transitionDuration: "400ms",
                transitionProperty: "opacity, transform",
                transitionTimingFunction: "ease-out",
              }}
            >
              <div
                className={`absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full border-2 transition-all duration-500 ${
                  i === 0
                    ? `${carrierTheme.timelineDotClass} animate-pulse-subtle`
                    : "bg-gray-800 border-gray-600"
                }`}
              />
              <div
                className={`rounded-xl border border-gray-800 bg-gray-900/70 p-4 shadow-md shadow-black/10 transition-colors hover:border-gray-700 ${carrierTheme.historyCardClass}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <StatusPill status={event.status} />
                    <p className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">
                      {event.detail}
                    </p>
                    {event.location && (
                      <p className="text-xs text-gray-500 mt-1.5">
                        {event.location}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px] leading-relaxed text-gray-500 shrink-0">
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
