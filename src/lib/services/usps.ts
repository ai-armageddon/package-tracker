import axios from 'axios';

const USPS_TRACK_URL = 'https://tools.usps.com/tools/app/resources/track/api/tracking-package-detail';

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

function formatLocation(ev: any): string {
  const parts = [ev.eventCity, ev.eventState, ev.eventZIPCode].filter(Boolean);
  return parts.join(', ');
}

export async function checkTracking(
  trackingNumbers: string[]
): Promise<TrackingResult[]> {
  const results: TrackingResult[] = [];

  for (const tn of trackingNumbers) {
    try {
      const { data } = await axios.get(USPS_TRACK_URL, {
        params: { trackingNumber: tn },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
        timeout: 15000,
      });

      const rawEvents = data.trackingEvents || [];
      const events: TrackingEvent[] = rawEvents.map((ev: any) => ({
        status: ev.eventType || ev.event || '',
        detail: ev.eventType || ev.event || '',
        location: formatLocation(ev),
        date: ev.eventDate || '',
        time: ev.eventTime || '',
      }));

      const status = data.trackingStatus || data.trackingInfo?.trackingStatus || 'Unknown';

      results.push({ trackingNumber: tn, summary: status, events });

      await new Promise((r) => setTimeout(r, 300));
    } catch (err: any) {
      console.error(`USPS error for ${tn}:`, err?.response?.status || err.message);
      results.push({ trackingNumber: tn, summary: '', events: [] });
    }
  }

  return results;
}
