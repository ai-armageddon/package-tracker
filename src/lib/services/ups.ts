import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { TrackingEvent, TrackingResult } from './usps';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://www.ups.com/track';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

type JsonRecord = Record<string, unknown>;

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTrackingNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getOwnString(record: JsonRecord, keys: string[]): string {
  const lowered = new Map(
    Object.keys(record).map((key) => [key.toLowerCase(), key])
  );

  for (const key of keys) {
    const actual = lowered.get(key.toLowerCase());
    if (!actual) continue;
    const value = record[actual];
    if (typeof value === 'string' && normalizeWhitespace(value)) {
      return normalizeWhitespace(value);
    }
    if (typeof value === 'number') return String(value);
  }

  return '';
}

function getDeepString(value: unknown, keys: string[]): string {
  if (!isRecord(value)) return '';

  const own = getOwnString(value, keys);
  if (own) return own;

  for (const nested of Object.values(value)) {
    if (isRecord(nested)) {
      const result = getDeepString(nested, keys);
      if (result) return result;
    }
  }

  return '';
}

function pushArrayValue(target: JsonRecord[], value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (isRecord(item)) target.push(item);
  }
}

function collectCandidateDetails(payload: unknown): JsonRecord[] {
  const candidates: JsonRecord[] = [];

  if (isRecord(payload)) {
    pushArrayValue(candidates, payload.trackDetails);
    pushArrayValue(candidates, payload.trackingDetails);
    pushArrayValue(candidates, payload.trackDetail);
    if (isRecord(payload.trackDetail)) candidates.push(payload.trackDetail);
    if (isRecord(payload.referenceTrackDetail)) candidates.push(payload.referenceTrackDetail);
  }

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isRecord(value)) return;

    const looksLikeTrackingDetail =
      getOwnString(value, [
        'trackingNumber',
        'packageStatusDescription',
        'packageStatus',
        'statusDescription',
      ]) || Array.isArray(value.shipmentProgressActivities);

    if (looksLikeTrackingDetail) candidates.push(value);

    for (const nested of Object.values(value)) walk(nested);
  }

  walk(payload);

  return candidates.filter(
    (candidate, index, all) => all.indexOf(candidate) === index
  );
}

function findTrackingDetail(payload: unknown, trackingNumber: string): JsonRecord | null {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const candidates = collectCandidateDetails(payload);

  return (
    candidates.find(
      (candidate) =>
        normalizeTrackingNumber(
          getDeepString(candidate, ['trackingNumber', 'trackingNo', 'trkNum'])
        ) === normalized
    ) ??
    candidates.find((candidate) =>
      normalizeTrackingNumber(JSON.stringify(candidate)).includes(normalized)
    ) ??
    candidates[0] ??
    null
  );
}

function getLocation(value: unknown): string {
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (!isRecord(value)) return '';

  const nestedLocation = value.location ?? value.Location;
  if (nestedLocation && nestedLocation !== value) {
    const location = getLocation(nestedLocation);
    if (location) return location;
  }

  const parts = [
    getOwnString(value, ['city', 'cityName', 'locationCity']),
    getOwnString(value, ['state', 'stateProvince', 'province', 'territory']),
    getOwnString(value, ['postalCode', 'zipCode']),
    getOwnString(value, ['country', 'countryCode']),
  ].filter(Boolean);

  return [...new Set(parts)].join(', ');
}

function normalizeTime(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\b([AP])\.?M\.?\b/gi, (_, ap) => `${ap.toUpperCase()}M`)
    .toUpperCase();
}

function splitDateTime(value: string): { date: string; time: string } {
  const cleaned = normalizeTime(value);
  const timeMatch = cleaned.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
  const time = timeMatch ? normalizeTime(timeMatch[0]) : '';
  const date = normalizeWhitespace(cleaned.replace(/\b(?:AT|BY)\b\s*/i, '').replace(timeMatch?.[0] ?? '', ''));
  return { date, time };
}

function extractDateTime(record: JsonRecord): { date: string; time: string } {
  const date =
    getDeepString(record, [
      'activityDate',
      'eventDate',
      'scanDate',
      'date',
      'localDate',
      'packageStatusDateAndYear',
      'packageStatusDate',
      'deliveredDate',
      'deliveryDate',
      'latestUpdateDate',
      'updateDate',
    ]) || '';
  const time = getDeepString(record, [
    'activityTime',
    'eventTime',
    'scanTime',
    'time',
    'localTime',
    'packageStatusTime',
    'deliveredTime',
    'deliveryTime',
    'latestUpdateTime',
    'updateTime',
  ]);
  const combined = getDeepString(record, [
    'dateTime',
    'activityDateTime',
    'eventDateTime',
    'scanDateTime',
    'trackedDateTime',
    'latestUpdate',
    'updateDateTime',
  ]);

  if (date && time) return { date, time: normalizeTime(time) };
  if (combined) return splitDateTime(combined);
  if (date) return splitDateTime(date);

  return { date: '', time: time ? normalizeTime(time) : '' };
}

function parseActivities(detail: JsonRecord): TrackingEvent[] {
  const activityArrays = [
    detail.shipmentProgressActivities,
    detail.activities,
    detail.activity,
    detail.events,
    detail.milestones,
    detail.milestoneList,
  ];

  const activities: JsonRecord[] = [];
  for (const activityArray of activityArrays) pushArrayValue(activities, activityArray);

  return activities
    .map((activity) => {
      const status =
        getDeepString(activity, [
          'activityScan',
          'milestoneName',
          'status',
          'statusDescription',
          'packageStatus',
          'packageStatusDescription',
          'description',
        ]) || 'UPS update';
      const detailText =
        getDeepString(activity, [
          'activityDescription',
          'detail',
          'details',
          'description',
          'message',
          'statusDescription',
        ]) || status;
      const location = getLocation(activity);
      const { date, time } = extractDateTime(activity);

      return {
        status,
        detail: detailText,
        location,
        date,
        time,
      };
    })
    .filter((event) => event.status || event.detail);
}

function parseJsonResponse(
  payload: unknown,
  trackingNumber: string
): TrackingResult | null {
  const detail = findTrackingDetail(payload, trackingNumber);
  if (!detail) return null;

  const errorText = getDeepString(detail, [
    'errorText',
    'errorMessage',
    'message',
    'statusText',
  ]);
  if (/unable to complete|try again later|system unavailable/i.test(errorText)) {
    return { trackingNumber, summary: 'UPS tracking temporarily unavailable', events: [] };
  }

  const events = parseActivities(detail);
  const status =
    getDeepString(detail, [
      'packageStatusDescription',
      'packageStatus',
      'statusDescription',
      'status',
      'currentStatus',
      'latestUpdate',
    ]) || errorText;
  const location = getLocation(detail);
  const { date, time } = extractDateTime(detail);

  if (events.length === 0 && status && !/tracking number|shipment progress|details/i.test(status)) {
    events.push({
      status,
      detail: status,
      location,
      date,
      time,
    });
  }

  const deduped = events.filter(
    (event, index, allEvents) =>
      index ===
      allEvents.findIndex(
        (other) =>
          other.status === event.status &&
          other.detail === event.detail &&
          other.location === event.location &&
          other.date === event.date &&
          other.time === event.time
      )
  );

  deduped.sort((a, b) => {
    const aTime = Date.parse(`${a.date} ${a.time}`) || 0;
    const bTime = Date.parse(`${b.date} ${b.time}`) || 0;
    return bTime - aTime;
  });

  return {
    trackingNumber,
    summary: status || deduped[0]?.detail || deduped[0]?.status || 'Unknown',
    events: deduped,
  };
}

function isLikelyStatus(line: string): boolean {
  return /delivered|on the way|in transit|out for delivery|processing|arrived|departed|loaded|received|label created|pickup|drop.?off|exception|delay|held|clearance|ready for pickup|delivery attempted/i.test(
    line
  );
}

function isLikelyLocation(line: string): boolean {
  return /^[A-Z][A-Z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?(?:,\s*[A-Z]{2})?$/i.test(line);
}

function parseRenderedText(text: string, trackingNumber: string): TrackingResult {
  const bodyText = text.replace(/\r/g, '\n');

  if (
    /tracking error[\s\S]{0,300}unable to complete your tracking request|unable to complete your tracking request at this time|please try again later/i.test(
      bodyText
    )
  ) {
    return { trackingNumber, summary: 'UPS tracking temporarily unavailable', events: [] };
  }

  const notFoundMatch = bodyText.match(
    /(no information found for this package|could not locate|invalid tracking number|not a valid tracking number|please provide a tracking number)[^\n.]*/i
  );
  if (notFoundMatch) {
    const detail = normalizeWhitespace(notFoundMatch[0]);
    return {
      trackingNumber,
      summary: detail,
      events: [
        {
          status: 'Tracking number not found',
          detail,
          location: '',
          date: '',
          time: '',
        },
      ],
    };
  }

  const lines = bodyText
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const events: TrackingEvent[] = [];
  const dateRe =
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday,\s*)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}|^\d{1,2}\/\d{1,2}\/\d{2,4}/i;
  const timeRe = /\b\d{1,2}:\d{2}\s*(?:A\.?M\.?|P\.?M\.?|AM|PM)\b/i;
  const noiseRe =
    /^(tracking|track|tracking number|shipment progress|date|time|status|location|details|view details|show details|help|recently tracked|watchlist|sign up|log in|tracking results)$/i;

  let summary = '';
  for (const line of lines) {
    if (noiseRe.test(line)) continue;
    if (isLikelyStatus(line)) {
      summary = line;
      break;
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const hasDate = dateRe.test(line);
    const hasTime = timeRe.test(line);
    if (!hasDate && !hasTime) continue;

    const date = hasDate
      ? normalizeWhitespace(line.replace(timeRe, ''))
      : dateRe.test(lines[index - 1] || '')
        ? lines[index - 1]
        : '';
    const time = hasTime
      ? normalizeTime(line.match(timeRe)?.[0] || '')
      : timeRe.test(lines[index + 1] || '')
        ? normalizeTime(lines[index + 1].match(timeRe)?.[0] || '')
        : '';

    let status = '';
    let location = '';

    for (let scan = index + 1; scan < Math.min(lines.length, index + 7); scan++) {
      const candidate = lines[scan];
      if (!status && isLikelyStatus(candidate) && !noiseRe.test(candidate)) {
        status = candidate;
        continue;
      }
      if (!location && isLikelyLocation(candidate)) {
        location = candidate;
      }
      if (status && location) break;
    }

    for (let scan = index - 1; scan >= Math.max(0, index - 5); scan--) {
      const candidate = lines[scan];
      if (!status && isLikelyStatus(candidate) && !noiseRe.test(candidate)) {
        status = candidate;
      }
      if (!location && isLikelyLocation(candidate)) {
        location = candidate;
      }
      if (status && location) break;
    }

    if (!status) continue;
    events.push({
      status,
      detail: status,
      location,
      date,
      time,
    });
  }

  const deduped = events.filter(
    (event, index, allEvents) =>
      index ===
      allEvents.findIndex(
        (other) =>
          other.status === event.status &&
          other.location === event.location &&
          other.date === event.date &&
          other.time === event.time
      )
  );

  deduped.sort((a, b) => {
    const aTime = Date.parse(`${a.date} ${a.time}`) || 0;
    const bTime = Date.parse(`${b.date} ${b.time}`) || 0;
    return bTime - aTime;
  });

  if (deduped.length === 0 && summary) {
    deduped.push({
      status: summary,
      detail: summary,
      location: '',
      date: '',
      time: '',
    });
  }

  return {
    trackingNumber,
    summary: summary || deduped[0]?.detail || 'Unknown',
    events: deduped,
  };
}

async function clickVisibleByText(
  page: import('puppeteer').Page,
  pattern: RegExp
): Promise<boolean> {
  return page.evaluate(
    (source, flags) => {
      const matcher = new RegExp(source, flags);
      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const element = Array.from(
        document.querySelectorAll<HTMLElement>('button, a')
      ).find((el) => matcher.test((el.textContent || '').trim()) && isVisible(el));

      if (!element) return false;
      element.click();
      return true;
    },
    pattern.source,
    pattern.flags
  );
}

async function submitTrackingFormIfNeeded(
  page: import('puppeteer').Page,
  trackingNumber: string
): Promise<boolean> {
  const input = await page.$('#stApp_trackingNumber, textarea[name="tracking_widget_input"]');
  if (!input) return false;

  const value = await input.evaluate((el) => (el as HTMLTextAreaElement).value || '');
  if (normalizeTrackingNumber(value) === normalizeTrackingNumber(trackingNumber)) return false;

  await input.click({ count: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(trackingNumber, { delay: 25 });

  return page.evaluate(() => {
    const inputEl = document.querySelector('#stApp_trackingNumber');
    const inputTop = inputEl?.getBoundingClientRect().top ?? 0;
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((btn) => {
      const text = (btn.textContent || '').trim();
      const rect = btn.getBoundingClientRect();
      return (
        /^Track/i.test(text) &&
        !/Reference|Import|Other|Tracking$/i.test(text) &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top > inputTop &&
        !btn.disabled
      );
    });

    if (!button) return false;
    button.click();
    return true;
  });
}

async function scrapePage(
  page: import('puppeteer').Page,
  trackingNumber: string
): Promise<TrackingResult> {
  const jsonPayloads: unknown[] = [];
  let sawNoContentStatus = false;

  const responseHandler = async (response: import('puppeteer').HTTPResponse) => {
    if (!response.url().includes('/track/api/Track/GetStatus')) return;
    if (response.request().method() !== 'POST') return;

    if (response.status() === 204) {
      sawNoContentStatus = true;
      return;
    }

    const contentType = response.headers()['content-type'] || '';
    if (!/json/i.test(contentType)) return;

    try {
      jsonPayloads.push(await response.json());
    } catch {
      // Ignore malformed or unavailable response bodies; rendered text parsing is next.
    }
  };

  page.on('response', responseHandler);

  try {
    const url = `${TRACK_URL}?track=yes&trackNums=${encodeURIComponent(trackingNumber)}&loc=en_US&requester=ST%2Ftrackdetails`;
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    await delay(7000);
    await clickVisibleByText(page, /^(allow all|accept all cookies|essential cookies only)$/i);
    await clickVisibleByText(page, /^(view all shipping details|view detailed progress|show details|view details)$/i);

    for (const payload of jsonPayloads) {
      const parsed = parseJsonResponse(payload, trackingNumber);
      if (parsed && parsed.events.length > 0) return parsed;
    }

    const submitted = await submitTrackingFormIfNeeded(page, trackingNumber);
    if (submitted) await delay(7000);
    await clickVisibleByText(page, /^(view all shipping details|view detailed progress|show details|view details)$/i);

    for (const payload of jsonPayloads) {
      const parsed = parseJsonResponse(payload, trackingNumber);
      if (parsed && parsed.events.length > 0) return parsed;
    }

    const text = await page.evaluate(() => document.body.innerText || '');
    const parsedText = parseRenderedText(text, trackingNumber);

    if (parsedText.events.length > 0 || !sawNoContentStatus) return parsedText;
    return {
      trackingNumber,
      summary: 'UPS tracking temporarily unavailable',
      events: [],
    };
  } finally {
    page.off('response', responseHandler);
  }
}

export async function checkUpsTracking(
  trackingNumbers: string[]
): Promise<TrackingResult[]> {
  if (trackingNumbers.length === 0) return [];

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en',
      '--window-size=1365,900',
    ],
  });

  const results: TrackingResult[] = [];

  try {
    for (const tn of trackingNumbers) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1365, height: 900 });
        await page.setUserAgent(USER_AGENT);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        const result = await scrapePage(page, tn);
        results.push(result);
      } catch (err: any) {
        console.error(`UPS scrape error for ${tn}:`, err.message);
        results.push({ trackingNumber: tn, summary: '', events: [] });
      } finally {
        await page.close();
      }
      await delay(3000);
    }
  } finally {
    await browser.close();
  }

  return results;
}
