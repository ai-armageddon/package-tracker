import axios from 'axios';

const SHIPPO_API = 'https://api.goshippo.com/tracks';

export interface TrackingEvent {
  status: string;
  detail: string;
  location: string;
  date: string;
  time: string;
}

export interface TrackingResult {
  trackingNumber: string;
  summary: string;
  events: TrackingEvent[];
}

function getHeaders(): Record<string, string> {
  const key = process.env.SHIPPO_API_KEY;
  if (!key) throw new Error('SHIPPO_API_KEY not configured');
  return { Authorization: `ShippoToken ${key}`, 'Content-Type': 'application/json' };
}

function formatLocation(loc: { city?: string; state?: string; zip?: string } | null | undefined): string {
  if (!loc) return '';
  const parts = [loc.city, loc.state, loc.zip].filter(Boolean);
  return parts.join(', ');
}

function parseTimestamp(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

export async function checkTracking(
  trackingNumbers: string[]
): Promise<TrackingResult[]> {
  const results: TrackingResult[] = [];

  for (const tn of trackingNumbers) {
    try {
      const { data } = await axios.get(
        `${SHIPPO_API}/usps/${encodeURIComponent(tn)}/`,
        { headers: getHeaders(), timeout: 15000 }
      );

      const history: TrackingEvent[] =
        data.tracking_history?.map((h: any) => {
          const d = parseTimestamp(h.status_date);
          return {
            status: h.status || '',
            detail: h.status_details || '',
            location: formatLocation(h.location),
            date: d.date,
            time: d.time,
          };
        }) || [];

      const current = data.tracking_status;
      const summary = current?.status_details || current?.status || 'Unknown';

      results.push({ trackingNumber: tn, summary, events: history });

      await new Promise((r) => setTimeout(r, 250));
    } catch (err: any) {
      console.error(`Shippo error for ${tn}:`, err?.response?.data || err.message);
      results.push({ trackingNumber: tn, summary: '', events: [] });
    }
  }

  return results;
}
