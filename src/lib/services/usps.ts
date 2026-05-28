import axios from 'axios';

const TRACK17_URL = 'https://api.17track.net/track/v2.2/gettrackinfo';

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

function getKey(): string {
  const key = process.env.TRACK17_API_KEY;
  if (!key) throw new Error('TRACK17_API_KEY not configured');
  return key;
}

function formatLocation(ev: any): string {
  const t = ev.location || ev.destinationInfo?.trackingLocation || {};
  const parts = [t.city, t.state, t.zip].filter(Boolean);
  return parts.join(', ');
}

export async function checkTracking(
  trackingNumbers: string[]
): Promise<TrackingResult[]> {
  const results: TrackingResult[] = [];

  // 17track accepts up to 40 tracking numbers per request
  const chunks: string[][] = [];
  for (let i = 0; i < trackingNumbers.length; i += 40) {
    chunks.push(trackingNumbers.slice(i, i + 40));
  }

  for (const chunk of chunks) {
    try {
      const { data } = await axios.post(
        TRACK17_URL,
        chunk.map((n) => ({ number: n, carrier: 21051 })),
        {
          headers: {
            '17token': getKey(),
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      if (data.code !== 0) {
        console.error('17TRACK error:', JSON.stringify(data));
        for (const tn of chunk) results.push({ trackingNumber: tn, summary: '', events: [] });
        continue;
      }

      const accepted = data.data?.accepted || [];
      for (let i = 0; i < accepted.length; i++) {
        const entry = accepted[i];
        const tn = entry.number || chunk[i] || '';

        // Try different possible response shapes
        const trackData = entry.track_info || entry.track;
        if (!trackData) {
          results.push({ trackingNumber: tn, summary: '', events: [] });
          continue;
        }

        // Handle both direct tracking array and nested format
        const rawEvents = trackData.tracking || trackData.events || (Array.isArray(trackData) ? trackData : []);

        const events: TrackingEvent[] = rawEvents.map((ev: any) => ({
          status: ev.status || ev.event || '',
          detail: ev.status || ev.event || '',
          location: formatLocation(ev),
          date: ev.date || '',
          time: ev.time || '',
        }));

        const summary =
          trackData.latest_status?.status ||
          trackData.summary ||
          events[0]?.status ||
          'Unknown';

        results.push({ trackingNumber: tn, summary, events });
      }
    } catch (err: any) {
      console.error('17TRACK error:', err?.response?.data || err.message);
      for (const tn of chunk) results.push({ trackingNumber: tn, summary: '', events: [] });
    }
  }

  return results;
}
