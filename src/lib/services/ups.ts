import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import treeKill from 'tree-kill';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { TrackingEvent, TrackingResult } from './usps';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://www.ups.com/track';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const CMS_DAYS: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const CMS_MONTHS: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};

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

function getCmsKeyName(value: string): string {
  return value.split('.').pop()?.toLowerCase() || value.toLowerCase();
}

function formatCmsTime(value: string): string {
  const key = getCmsKeyName(value);
  const byTime = key.match(/^by(\d{1,2})(am|pm)$/i);
  if (byTime) {
    const [, hour, meridiem] = byTime;
    return `by ${hour}:00 ${meridiem.toUpperCase().replace('AM', 'A.M.').replace('PM', 'P.M.')}`;
  }

  if (/endofday/i.test(key)) return 'by end of day';
  return normalizeWhitespace(value);
}

function buildEstimatedDelivery(detail: JsonRecord): string {
  const scheduled = detail.scheduledDeliveryDateDetail;
  const dayKey = getDeepString(detail, ['scheduledDeliveryDayCMSKey']);
  const timeKey = getDeepString(detail, ['packageStatusTime']);

  if (!isRecord(scheduled)) return '';

  const dayName = dayKey ? CMS_DAYS[getCmsKeyName(dayKey)] : '';
  const monthKey = getOwnString(scheduled, ['monthCMSKey']);
  const monthName = monthKey ? CMS_MONTHS[getCmsKeyName(monthKey)] : '';
  const dayNum = getOwnString(scheduled, ['dayNum']);
  const timeText = timeKey ? formatCmsTime(timeKey) : '';
  const dateText = [dayName, [monthName, dayNum].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return [dateText, timeText].filter(Boolean).join(' ');
}

function withEstimatedDelivery(detail: string, estimatedDelivery: string): string {
  if (!estimatedDelivery || /estimated delivery/i.test(detail)) return detail;
  return `${detail} — Estimated delivery ${estimatedDelivery}`;
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
    .replace(/\b([AP])\.?\s?M\.?/gi, (_, ap) => `${ap.toUpperCase()}M`)
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
    .map((activity): TrackingEvent | null => {
      const status =
        getDeepString(activity, [
          'activityScan',
          'milestoneName',
          'name',
          'status',
          'statusDescription',
          'packageStatus',
          'packageStatusDescription',
          'description',
        ]) || '';
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

      if (activity.isFuture === true && !date && !time && !location) {
        return null;
      }

      if (!status && !detailText) return null;

      return {
        status: status || detailText,
        detail: detailText,
        location,
        date,
        time,
      };
    })
    .filter((event): event is TrackingEvent => !!event && (!!event.status || !!event.detail));
}

function getCurrentMilestone(detail: JsonRecord): JsonRecord | null {
  const milestoneValues = [detail.milestones, detail.milestoneList];

  for (const milestones of milestoneValues) {
    if (!Array.isArray(milestones)) continue;
    const current = milestones.find(
      (milestone): milestone is JsonRecord =>
        isRecord(milestone) && (milestone.isCurrent === true || getOwnString(milestone, ['isCurrent']) === 'true')
    );
    if (current) return current;
  }

  return isRecord(detail.currentMilestone) ? detail.currentMilestone : null;
}

function isSameEventMoment(a: TrackingEvent, b: TrackingEvent): boolean {
  if (!a.date && !a.time && !b.date && !b.time) return false;
  return a.date === b.date && a.time === b.time && (!a.location || !b.location || a.location === b.location);
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

  let events = parseActivities(detail);
  const estimatedDelivery = buildEstimatedDelivery(detail);
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
  const currentMilestone = getCurrentMilestone(detail);
  const currentStatus = status || getDeepString(currentMilestone, ['name']);
  const currentLocation = getLocation(currentMilestone) || location;
  const currentDateTime = currentMilestone ? extractDateTime(currentMilestone) : { date, time };

  if (events.length === 0 && status && !/tracking number|shipment progress|details/i.test(status)) {
    events.push({
      status,
      detail: withEstimatedDelivery(status, estimatedDelivery),
      location,
      date,
      time,
    });
  }

  if (currentStatus && (currentLocation || currentDateTime.date || currentDateTime.time)) {
    const currentEvent = {
      status: currentStatus,
      detail: withEstimatedDelivery(currentStatus, estimatedDelivery),
      location: currentLocation,
      date: currentDateTime.date,
      time: currentDateTime.time,
    };
    const hasCurrentEvent = events.some(
      (event) =>
        event.status === currentEvent.status &&
        event.location === currentEvent.location &&
        event.date === currentEvent.date &&
        event.time === currentEvent.time
    );

    if (!hasCurrentEvent) events.unshift(currentEvent);
  }

  const currentIndex = events.findIndex(
    (event) =>
      (!!currentStatus && event.status.toLowerCase() === currentStatus.toLowerCase()) ||
      (!!currentDateTime.date && event.date === currentDateTime.date && event.time === currentDateTime.time)
  );
  if (currentIndex >= 0) {
    const currentEvent = events[currentIndex];
    const statusMatchesCurrent =
      !!currentStatus && currentEvent.status.toLowerCase() === currentStatus.toLowerCase();
    const matchingScan = events.find(
      (event, index) =>
        index !== currentIndex &&
        isSameEventMoment(event, currentEvent) &&
        (!currentStatus || event.status.toLowerCase() !== currentStatus.toLowerCase())
    );
    const detailSource = statusMatchesCurrent
      ? matchingScan?.detail || matchingScan?.status || currentEvent.detail || currentEvent.status
      : currentEvent.detail || currentEvent.status;

    events[currentIndex] = {
      ...currentEvent,
      status: currentStatus || currentEvent.status,
      detail: withEstimatedDelivery(detailSource, estimatedDelivery),
      location: currentEvent.location || currentLocation,
    };

    const mergedCurrent = events[currentIndex];
    events = events.filter(
      (event, index) => index === currentIndex || !isSameEventMoment(event, mergedCurrent)
    );
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
  return /^[A-Z][A-Z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?(?:,\s*(?:[A-Z]{2}|[A-Z][A-Z .'-]+))?$/i.test(line);
}

function getLineAfterLabel(lines: string[], label: RegExp): string {
  const index = lines.findIndex((line) => label.test(line));
  if (index === -1) return '';

  for (let scan = index + 1; scan < lines.length; scan++) {
    const candidate = lines[scan];
    if (candidate && !/^(check|close|completed|active|inactive)$/i.test(candidate)) return candidate;
  }

  return '';
}

function parseLastLocationLine(line: string): { location: string; date: string; time: string } | null {
  const match = line.match(
    /^(.+?),\s*(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}\s*(?:A\.?M\.?|P\.?M\.?|AM|PM))$/i
  );
  if (!match) return null;

  return {
    location: normalizeWhitespace(match[1]),
    date: match[2],
    time: normalizeTime(match[3]),
  };
}

function isRenderedNoiseLine(line: string, trackingNumber: string): boolean {
  return (
    normalizeTrackingNumber(line) === normalizeTrackingNumber(trackingNumber) ||
    /^(tracking|track|tracking number|shipment progress|date|time|status|location|details|view details|show details|hide details|help|recently tracked|watchlist|sign up|log in|tracking results|package history|select time zone|change my delivery|notify me)$/i.test(line) ||
    /^keyboard_arrow_/i.test(line) ||
    /^expand_(?:more|less)$/i.test(line)
  );
}

function parseDateBlockEvents(
  lines: string[],
  trackingNumber: string,
  dateRe: RegExp,
  timeRe: RegExp
): TrackingEvent[] {
  const events: TrackingEvent[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const hasDate = dateRe.test(line);
    if (!hasDate) continue;

    const date = normalizeWhitespace(line.replace(timeRe, ''));
    const timeOnDateLine = line.match(timeRe)?.[0] || '';
    const nextLineTime = lines[index + 1]?.match(timeRe)?.[0] || '';
    const time = normalizeTime(timeOnDateLine || nextLineTime);
    const contentStart = timeOnDateLine ? index + 1 : nextLineTime ? index + 2 : index + 1;
    let contentEnd = contentStart;

    while (contentEnd < lines.length && !dateRe.test(lines[contentEnd])) {
      contentEnd++;
    }

    const block = lines
      .slice(contentStart, contentEnd)
      .filter((candidate) => !timeRe.test(candidate))
      .filter((candidate) => !isRenderedNoiseLine(candidate, trackingNumber));

    if (block.length === 0) continue;

    let locationIndex = -1;
    for (let blockIndex = block.length - 1; blockIndex >= 0; blockIndex--) {
      if (isLikelyLocation(block[blockIndex])) {
        locationIndex = blockIndex;
        break;
      }
    }
    const location = locationIndex >= 0 ? block[locationIndex] : '';
    const descriptionLines = block.filter((_, blockIndex) => blockIndex !== locationIndex);
    if (descriptionLines.length === 0) continue;

    const statusIndex = descriptionLines.findIndex((candidate) => isLikelyStatus(candidate));
    const status = statusIndex >= 0 ? descriptionLines[statusIndex] : descriptionLines[0];
    const detailLines =
      statusIndex >= 0
        ? descriptionLines.filter((_, detailIndex) => detailIndex !== statusIndex)
        : descriptionLines.slice(1);
    const detail = detailLines.length > 0 ? detailLines.join(' ') : status;

    events.push({
      status,
      detail,
      location,
      date,
      time,
    });
  }

  return events;
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

  let summary = '';
  for (const line of lines) {
    if (isRenderedNoiseLine(line, trackingNumber)) continue;
    if (isLikelyStatus(line)) {
      summary = line;
      break;
    }
  }

  const estimatedDelivery = getLineAfterLabel(lines, /^estimated delivery$/i);
  const lastLocation = parseLastLocationLine(getLineAfterLabel(lines, /^last location:?$/i));

  events.push(...parseDateBlockEvents(lines, trackingNumber, dateRe, timeRe));

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
      detail: withEstimatedDelivery(summary, estimatedDelivery),
      location: '',
      date: '',
      time: '',
    });
  }

  if (lastLocation && summary) {
    const lastLocationEvent: TrackingEvent = {
      status: summary,
      detail: withEstimatedDelivery(summary, estimatedDelivery),
      location: lastLocation.location,
      date: lastLocation.date,
      time: lastLocation.time,
    };
    const existingIndex = deduped.findIndex(
      (event) =>
        event.status === lastLocationEvent.status &&
        event.location === lastLocationEvent.location &&
        event.date === lastLocationEvent.date &&
        event.time === lastLocationEvent.time
    );

    if (existingIndex === -1) {
      deduped.unshift(lastLocationEvent);
    } else {
      deduped[existingIndex] = {
        ...deduped[existingIndex],
        detail: withEstimatedDelivery(
          deduped[existingIndex].detail || deduped[existingIndex].status,
          estimatedDelivery
        ),
      };
    }
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
      const normalizeButtonText = (value: string) =>
        value
          .replace(/\bkeyboard_arrow_(?:up|down|left|right)\b/gi, ' ')
          .replace(/\bexpand_(?:more|less)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      const element = Array.from(
        document.querySelectorAll<HTMLElement>('button, a, [role="button"]')
      ).find((el) => {
        const labels = [
          normalizeButtonText(el.innerText || ''),
          normalizeButtonText(el.textContent || ''),
          normalizeButtonText(el.getAttribute('aria-label') || ''),
        ].filter(Boolean);
        if (!labels.some((label) => matcher.test(label))) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      });

      if (!element) return false;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return true;
    },
    pattern.source,
    pattern.flags
  );
}

async function expandUpsDetails(page: import('puppeteer').Page): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const alreadyExpanded = await page
      .evaluate(() => /package history|hide details/i.test(document.body.innerText || ''))
      .catch(() => false);
    if (alreadyExpanded) return true;

    const clicked = await clickVisibleByText(
      page,
      /^(view all shipping details|view detailed progress|show details|view details)$/i
    );
    if (!clicked) return false;

    await page
      .waitForFunction(() => /package history|hide details/i.test(document.body.innerText || ''), {
        timeout: 5000,
      })
      .catch(() => undefined);
  }

  return page
    .evaluate(() => /package history|hide details/i.test(document.body.innerText || ''))
    .catch(() => false);
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

  const debug = process.env.UPS_DEBUG === 'true';

  const responseHandler = async (response: import('puppeteer').HTTPResponse) => {
    const url = response.url();
    const method = response.request().method();
    if (debug && (url.includes('/track') || url.includes('/Track'))) {
      console.log(`[UPS DEBUG] ${method} ${response.status()} ${url}`);
    }
    if (!url.includes('/track/api/Track/GetStatus') && !url.includes('/track/api/Track/GetStatusExt')) return;
    if (method !== 'POST') return;

    if (response.status() === 204) {
      sawNoContentStatus = true;
      return;
    }

    const contentType = response.headers()['content-type'] || '';
    if (!/json/i.test(contentType)) return;

    try {
      const json = await response.json();
      if (debug) console.log(`[UPS DEBUG] JSON payload for ${trackingNumber}:\n`, JSON.stringify(json, null, 2).slice(0, 4000));
      jsonPayloads.push(json);
    } catch {
      // Ignore malformed or unavailable response bodies; rendered text parsing is next.
    }
  };

  page.on('response', responseHandler);

  const parseCapturedPayloads = (): TrackingResult | null => {
    for (const payload of jsonPayloads) {
      const parsed = parseJsonResponse(payload, trackingNumber);
      if (parsed && parsed.events.length > 0) return parsed;
    }
    return null;
  };

  const dismissConsent = async () => {
    await clickVisibleByText(
      page,
      /^(allow all|accept all cookies|accept all|essential cookies only|i agree|got it)$/i
    );
  };

  try {
    const url = `${TRACK_URL}?track=yes&trackNums=${encodeURIComponent(trackingNumber)}&loc=en_US&requester=ST%2Ftrackdetails`;

    // The UPS SPA occasionally returns a 204 (anti-bot) or fails to fire the
    // GetStatus call on the first load. Reload a couple of times before giving up.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt === 1) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } else {
        sawNoContentStatus = false;
        if (debug) console.log(`[UPS DEBUG] Reload attempt ${attempt} for ${trackingNumber}`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      }

      // Accept cookie consent up front — on a fresh profile the consent gate can
      // block the GetStatus API from firing at all.
      await dismissConsent();
      await waitForUpsResult(page, jsonPayloads, trackingNumber);
      await dismissConsent();
      await expandUpsDetails(page);

      const parsed = parseCapturedPayloads();
      if (parsed) return parsed;

      // Got JSON but it had no events (genuine "no info yet"), stop retrying.
      if (jsonPayloads.length > 0 && !sawNoContentStatus) break;
    }

    const submitted = await submitTrackingFormIfNeeded(page, trackingNumber);
    if (submitted) await waitForUpsResult(page, jsonPayloads, trackingNumber);
    await expandUpsDetails(page);

    const parsedAfterSubmit = parseCapturedPayloads();
    if (parsedAfterSubmit) return parsedAfterSubmit;

    const text = await page.evaluate(() => document.body.innerText || '');
    if (debug) console.log(`[UPS DEBUG] Rendered text for ${trackingNumber} (first 2000 chars):\n`, text.slice(0, 2000));
    const parsedText = parseRenderedText(text, trackingNumber);

    if (parsedText.events.length === 0) {
      console.warn(
        `[UPS] No events for ${trackingNumber} ` +
          `(jsonPayloads=${jsonPayloads.length}, noContent204=${sawNoContentStatus}). ` +
          `Likely anti-bot block or slow load.`
      );
    }

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

async function waitForUpsResult(
  page: import('puppeteer').Page,
  jsonPayloads: unknown[],
  trackingNumber: string,
  timeoutMs = 25000
) {
  const started = Date.now();
  const normalized = normalizeTrackingNumber(trackingNumber);

  while (Date.now() - started < timeoutMs) {
    if (jsonPayloads.some((payload) => parseJsonResponse(payload, trackingNumber)?.events.length)) {
      return;
    }

    const hasResult = await page
      .evaluate((tn) => {
        const text = document.body.innerText || '';
        const hasTrackingContent =
          text.includes('Tracking Details') ||
          text.includes('Shipment Progress') ||
          text.includes('Package Progress') ||
          text.includes('Tracking Results') ||
          /delivered/i.test(text) ||
          /out for delivery/i.test(text) ||
          /in transit/i.test(text);
        return hasTrackingContent && text.toUpperCase().includes(tn);
      }, normalized)
      .catch(() => false);

    if (hasResult) return;
    await delay(500);
  }
}

function findChromeExecutable(): string | undefined {
  const configured = process.env.UPS_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    configured,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

export async function checkUpsTracking(
  trackingNumbers: string[]
): Promise<TrackingResult[]> {
  if (trackingNumbers.length === 0) return [];

  const chromeExecutable = findChromeExecutable();
  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-tracker-ups-'));
  const browser = await puppeteer.launch({
    executablePath: chromeExecutable,
    headless: process.env.UPS_BROWSER_MODE === 'headful' ? false : true,
    userDataDir: process.env.UPS_BROWSER_USER_DATA_DIR || tempProfileDir,
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
        if (!chromeExecutable) {
          await page.setUserAgent(USER_AGENT);
        }
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
    const pid = browser.process()?.pid;
    await browser.close().catch(() => {});
    if (pid) {
      await new Promise<void>((resolve) => treeKill(pid, 'SIGKILL', () => resolve()));
    }
    if (!process.env.UPS_BROWSER_USER_DATA_DIR) {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    }
  }

  return results;
}
