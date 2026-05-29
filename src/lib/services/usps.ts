import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

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

  const data = await page.evaluate(() => {
    const body = document.body.innerText;

    const descriptions = [
      'USPS is now in possession of your item',
      'Your item arrived at',
      'Your item was delivered',
      'Your item departed',
      'Your item is',
      'Status information is',
    ];
    let description = '';
    for (const prefix of descriptions) {
      const descMatch = body.match(new RegExp(`(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?\\.)`, 'i'));
      if (descMatch) {
        description = descMatch[0].trim();
        break;
      }
    }

    const startIdx = body.indexOf('On the Way\n');
    const endIdx = body.indexOf('\nWhat Do USPS Tracking Statuses Mean');
    const section =
      startIdx >= 0 && endIdx >= 0
        ? body.substring(startIdx, endIdx)
        : body;

    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);

    const dateRe = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))$/i;
    const capsRe = /^[A-Z][A-Z\s,.-]+$/;

    const knownStatuses = new Set([
      'Delivered', 'Out for Delivery', 'Preparing for Delivery',
      'Arrived at USPS Facility', 'Arrived at Post Office',
      'In Transit to Next Facility', 'Departed USPS Facility',
      'Departed Post Office', 'Accepted',
      'Accepted at USPS Facility', 'Accepted at USPS Origin Facility',
      'USPS in possession of item', 'USPS picked up item',
      'Shipping Label Created, USPS Awaiting Item',
      'Shipping Label Created', 'Available for Pickup',
      'On the Way',
    ]);

    const events: Array<{ status: string; detail: string; location: string; date: string; time: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const dateMatch = lines[i].match(dateRe);
      if (!dateMatch) continue;

      const date = dateMatch[1] + ' ' + dateMatch[2] + ', ' + dateMatch[3];
      const time = dateMatch[4];

      let status = '';
      let location = '';

      const prev = i >= 1 ? lines[i - 1] : '';
      const prevPrev = i >= 2 ? lines[i - 2] : '';

      if (capsRe.test(prev) && knownStatuses.has(prevPrev)) {
        status = prevPrev;
        location = prev;
      } else if (knownStatuses.has(prev)) {
        status = prev;
        location = '';
      } else {
        continue;
      }

      events.push({ status, detail: status, location, date, time });
    }

    // Fallback: extract event from description if no timeline events found
    if (events.length === 0 && description) {
      const locMatch = description.match(/(?:in|at)\s+([A-Z][A-Z\s,]+(?:[A-Z]{2})?(?:\s+\d{5})?)(?:\.|$)/i);
      const loc = locMatch ? locMatch[1].trim() : '';

      // Try "Month DD, YYYY HH:MM AM/PM" or "HH:MM am/pm on Month DD, YYYY"
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
        const statusMatch = description.match(/^(USPS is now in possession|Your item arrived|Your item departed|Your item was delivered|Your item is)/i);
        const st = statusMatch ? statusMatch[0] : 'Accepted';
        events.push({ status: st, detail: st, location: loc, date: d, time: t });
      }
    }

    return { description, events };
  });

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
    await browser.close();
  }

  return results;
}
