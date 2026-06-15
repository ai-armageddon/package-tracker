import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import treeKill from 'tree-kill';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://tools.usps.com/tracking';

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

async function scrapePage(
  page: import('puppeteer').Page,
  trackingNumber: string
): Promise<TrackingResult> {
  await page.goto(`${TRACK_URL}/${encodeURIComponent(trackingNumber)}`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await new Promise((r) => setTimeout(r, 3000));

  const data = await page.evaluate((trackingNumber) => {
    const body = document.body.innerText;
    const allLines = body.split('\n').map((l) => l.trim()).filter(Boolean);

    const latestUpdateStopRe =
      /^(Get More Out of USPS Tracking:?|USPS Tracking Plus(?:®)?|Text & Email Updates|Product Information|See Less|Track Another Package|What Do USPS Tracking Statuses Mean\??|Need More Help\??|FAQs)$/i;
    const latestUpdateIndex = allLines.findIndex((line) =>
      /^Latest Update$/i.test(line)
    );
    const descriptions = [
      'USPS is now in possession of your item',
      'Your item arrived at',
      'Your item arrived at a shipping partner facility',
      'Your item was delivered',
      'Your item departed',
      'Your item departed a shipping partner facility',
      'Your item is',
      'Status information is',
    ];
    let description = '';

    if (latestUpdateIndex >= 0) {
      const latestUpdateLines: string[] = [];
      for (let k = latestUpdateIndex + 1; k < allLines.length; k++) {
        const line = allLines[k];
        if (
          line === trackingNumber ||
          /^Tracking Number:?$/i.test(line) ||
          /^Copy Add to Informed Delivery$/i.test(line)
        ) {
          continue;
        }
        if (latestUpdateStopRe.test(line)) break;
        latestUpdateLines.push(line);
      }
      description = latestUpdateLines.join(' ').trim();
    }

    for (const prefix of descriptions) {
      if (description) break;
      const descMatch = body.match(new RegExp(`(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?\\.)`, 'i'));
      if (descMatch) description = descMatch[0].trim();
    }

    const startMarkers = [
      'On the Way\n',
      'USPS Awaiting Item\n',
      'Moving Through Network\n',
      'Out for Delivery\n',
      'Delivered\n',
      'Latest Update\n',
    ];
    const startIdx = startMarkers.reduce((earliest, marker) => {
      const idx = body.indexOf(marker);
      if (idx === -1) return earliest;
      return earliest === -1 ? idx : Math.min(earliest, idx);
    }, -1);
    const endIdx = body.indexOf('\nWhat Do USPS Tracking Statuses Mean');
    const section =
      startIdx >= 0 && endIdx >= 0
        ? body.substring(startIdx, endIdx)
        : body;

    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);

    const dateRe = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))$/i;
    const dateReShort = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i;
    const timeRe = /\d{1,2}:\d{2}\s*(?:AM|PM)/i;
    const locRe = /^[A-Z][A-Za-z\s,.'\-]+(?:[A-Z]{2})?(?:\s+\d{5}(?:-\d+)?)?(?:\s+[A-Z][A-Za-z\s,.'\-]+)*$/;
    const isDateLine = (line: string) => dateRe.test(line) || dateReShort.test(line);

    const knownStatuses = new Set([
      'Delivered', 'Out for Delivery', 'Preparing for Delivery',
      'Arrived at USPS Facility', 'Arrived at Post Office',
      'In Transit to Next Facility', 'Departed USPS Facility',
      'Departed Post Office', 'Accepted',
      'Accepted at USPS Facility', 'Accepted at USPS Origin Facility',
      'USPS in possession of item', 'USPS picked up item',
      'Shipping Label Created, USPS Awaiting Item',
      'Shipping Label Created', 'Available for Pickup',
      'On the Way', 'Delivered, Individual Picked Up at Post Office',
      'Delivered, Left with Individual', 'Delivered, PO Box',
      'Delivered, Parcel Locker', 'Delivered, Front Desk/Reception',
      'Forwarded', 'Processing Exception', 'Arrived at Hub',
      'Departed USPS Regional Facility', 'Arrived at USPS Regional Facility',
      'Processed through USPS Facility', 'Missent',
      'Moving Through Network', 'In Transit, Arriving Late',
      'Pre-Shipment Info Sent to USPS, USPS Awaiting Item',
      'USPS Awaiting Item', 'Arrived Shipping Partner Facility',
      'Arrived Shipping Partner Facility, USPS Awaiting Item',
      'Departed Shipping Partner Facility',
      'Departed Shipping Partner Facility, USPS Awaiting Item',
      'Picked up by Shipping Partner', 'Picked Up by Shipping Partner',
    ]);
    const knownStatusLookup = new Map(
      Array.from(knownStatuses).map((status) => [status.toLowerCase(), status])
    );
    const shippingPartnerStatusRe =
      /^(?:Arrived|Departed) Shipping Partner Facility(?:,\s*USPS Awaiting Item)?$/i;
    const getStatusLine = (line: string) => {
      const knownStatus = knownStatusLookup.get(line.toLowerCase());
      if (knownStatus) return line;
      if (shippingPartnerStatusRe.test(line)) return line;
      if (/^Picked up by Shipping Partner$/i.test(line)) return line;
      if (/^USPS Awaiting Item$/i.test(line)) return line;
      return '';
    };

    const events: Array<{ status: string; detail: string; location: string; date: string; time: string }> = [];

    let i = 0;
    while (i < lines.length) {
      const dateMatch = lines[i].match(dateRe);
      if (!dateMatch) { i++; continue; }

      const date = dateMatch[1] + ' ' + dateMatch[2] + ', ' + dateMatch[3];
      const time = dateMatch[4];

      let status = '';
      let location = '';
      const locParts: string[] = [];

      for (let j = i - 1; j >= 0; j--) {
        const line = lines[j];
        if (isDateLine(line)) break;
        const statusLine = getStatusLine(line);
        if (statusLine) {
          status = statusLine;
          break;
        }
        if (locRe.test(line) && !/\d{1,2}:\d{2}/.test(line)) {
          locParts.unshift(line);
        }
      }

      location = locParts.join(', ');

      if (!status) continue;

      const detail = status + (location ? ` — ${location}` : '');
      events.push({ status, detail, location, date, time });
      i++;
    }

    if (events.length > 0 && description) {
      events[0].detail = description;
    }

    // Fallback: extract event from description if no timeline events found
    if (events.length === 0 && description) {
      const locMatch = description.match(/(?:in|at)\s+([A-Z][A-Z\s,]+(?:[A-Z]{2})?(?:\s+\d{5})?)(?:\.|$)/i);
      const loc = locMatch ? locMatch[1].trim() : '';

      let d = '';
      let t = '';
      const fmt1 = description.match(
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:AM|PM))/i
      );
      const fmt2 = description.match(
        /(?:as of|at)\s+(\d{1,2}:\d{2}\s*(?:am|pm))\s+on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i
      );

      if (fmt1) {
        d = fmt1[1] + ' ' + fmt1[2] + ', ' + fmt1[3];
        t = fmt1[4].toUpperCase();
      } else if (fmt2) {
        d = fmt2[2] + ' ' + fmt2[3] + ', ' + fmt2[4];
        t = fmt2[1].toUpperCase();
      }

      if (d) {
        let st = 'Accepted';
        if (/departed a shipping partner facility/i.test(description)) {
          st = 'Departed Shipping Partner Facility';
        } else if (/arrived at a shipping partner facility/i.test(description)) {
          st = 'Arrived Shipping Partner Facility';
        } else if (/picked up by (?:a )?shipping partner/i.test(description)) {
          st = 'Picked up by Shipping Partner';
        } else {
          const statusMatch = description.match(/^(USPS is now in possession|Your item arrived|Your item departed|Your item was delivered|Your item is)/i);
          st = statusMatch ? statusMatch[0] : st;
        }
        events.push({ status: st, detail: description, location: loc, date: d, time: t });
      }
    }

    return { description, events };
  }, trackingNumber);

  return {
    trackingNumber,
    summary: data.description || 'Unknown',
    events: data.events,
  };
}

export async function checkTracking(
  trackingNumbers: string[]
): Promise<TrackingResult[]> {
  if (trackingNumbers.length === 0) return [];

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const results: TrackingResult[] = [];

  try {
    for (const tn of trackingNumbers) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 800 });
        const result = await scrapePage(page, tn);
        results.push(result);
      } catch (err: any) {
        console.error(`USPS scrape error for ${tn}:`, err.message);
        results.push({ trackingNumber: tn, summary: '', events: [] });
      } finally {
        await page.close();
      }
      // 3s cooldown between pages — keeps USPS happy
      await new Promise((r) => setTimeout(r, 3000));
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
