import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import treeKill from 'tree-kill';
import type { TrackingEvent, TrackingResult } from './usps';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://www.uniuni.com/tracking/';
const TRACKING_RESPONSE_PATH = '/tracking/trackinguniuninew';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function normalizeTrackingNumber(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase();
}

function formatTimestamp(value: unknown): { date: string; time: string } {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return { date: '', time: '' };

  const parsed = new Date(numeric * 1000);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };

  return {
    date: parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    time: parsed.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
  };
}

function parseEvent(value: unknown): TrackingEvent | null {
  if (!isRecord(value)) return null;

  const status = readString(value, 'code', 'description_en', 'pathInfo');
  if (!status) return null;

  const detail = readString(value, 'pathInfo', 'description_en', 'code') || status;
  const location = readString(value, 'pathAddress', 'pathAddr');
  const { date, time } = formatTimestamp(value.pathTime);

  return { status, detail, location, date, time };
}

export function parseUniUniTrackingResponse(
  payload: unknown,
  trackingNumber: string,
): TrackingResult {
  const emptyResult: TrackingResult = {
    trackingNumber,
    summary: '',
    events: [],
  };

  if (!isRecord(payload) || !isRecord(payload.data)) return emptyResult;

  const shipments = Array.isArray(payload.data.valid_tno)
    ? payload.data.valid_tno.filter(isRecord)
    : [];
  const normalized = normalizeTrackingNumber(trackingNumber);
  const shipment =
    shipments.find(
      (candidate) =>
        normalizeTrackingNumber(readString(candidate, 'tno')) === normalized,
    ) ?? shipments[0];

  if (!shipment) {
    return {
      ...emptyResult,
      summary: readString(payload, 'ret_msg'),
    };
  }

  const events = (Array.isArray(shipment.spath_list) ? shipment.spath_list : [])
    .map(parseEvent)
    .filter((event): event is TrackingEvent => Boolean(event))
    .sort((left, right) => {
      const leftTime = Date.parse(`${left.date} ${left.time}`) || 0;
      const rightTime = Date.parse(`${right.date} ${right.time}`) || 0;
      return rightTime - leftTime;
    });

  return {
    trackingNumber,
    summary: events[0]?.detail || readString(shipment, 'state') || '',
    events,
  };
}

async function scrapePage(
  page: import('puppeteer').Page,
  trackingNumber: string,
): Promise<TrackingResult> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const responsePromise = page
    .waitForResponse(
      (response) => {
        if (!response.url().includes(TRACKING_RESPONSE_PATH)) return false;

        try {
          const requestedNumber = new URL(response.url()).searchParams.get('id') || '';
          return normalizeTrackingNumber(requestedNumber) === normalized;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .catch(() => null);

  await page.goto(`${TRACK_URL}?no=${encodeURIComponent(normalized)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  const response = await responsePromise;
  if (!response) {
    throw new Error('UniUni tracking response was not received');
  }

  return parseUniUniTrackingResponse(await response.json(), normalized);
}

export async function checkUniUniTracking(
  trackingNumbers: string[],
): Promise<TrackingResult[]> {
  if (trackingNumbers.length === 0) return [];

  const browser = await puppeteer.launch({
    headless: process.env.UNIUNI_BROWSER_MODE !== 'headful',
    executablePath: process.env.UNIUNI_CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const results: TrackingResult[] = [];

  try {
    for (const trackingNumber of trackingNumbers) {
      const normalized = normalizeTrackingNumber(trackingNumber);
      const page = await browser.newPage();

      try {
        await page.setViewport({ width: 1280, height: 800 });
        results.push(await scrapePage(page, normalized));
      } catch (err) {
        console.error(`UniUni scrape error for ${normalized}:`, err);
        results.push({ trackingNumber: normalized, summary: '', events: [] });
      } finally {
        await page.close();
      }

      if (trackingNumbers.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } finally {
    const pid = browser.process()?.pid;
    await browser.close().catch(() => {});
    if (pid) {
      await new Promise<void>((resolve) => treeKill(pid, 'SIGKILL', () => resolve()));
    }
  }

  return results;
}
