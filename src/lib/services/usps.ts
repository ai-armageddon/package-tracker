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

    // Extract description (e.g. "Your item arrived at...")
    const descMatch = body.match(
      /(?:Status|Your item)[\s\S]*?\.(?=\s*(?:Get More|Tracking Number|USPS Tracking))/i
    );
    const description = descMatch ? descMatch[0].trim() : '';

    // Get tracking section
    const startIdx = body.indexOf('On the Way\n');
    const endIdx = body.indexOf('\nWhat Do USPS Tracking Statuses Mean');
    const section =
      startIdx >= 0 && endIdx >= 0
        ? body.substring(startIdx, endIdx)
        : body;

    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);

    // Parse events: pattern can be:
    //   STATUS
    //   LOCATION (optional, all-caps)
    //   DATE TIME
    const events: Array<{ status: string; detail: string; location: string; date: string; time: string }> = [];
    const dateRe = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))$/i;
    const capsRe = /^[A-Z][A-Z\s,.-]+$/;

    const knownStatuses = new Set([
      'Delivered', 'Out for Delivery', 'Preparing for Delivery',
      'Arrived at USPS Facility', 'Arrived at Post Office',
      'In Transit to Next Facility', 'Departed USPS Facility',
      'Accepted at USPS Facility', 'USPS in possession of item',
      'Shipping Label Created', 'Available for Pickup',
      'On the Way',
    ]);

    for (let i = 0; i < lines.length; i++) {
      const dateMatch = lines[i].match(dateRe);
      if (!dateMatch) continue;

      const date = dateMatch[1] + ' ' + dateMatch[2] + ', ' + dateMatch[3];
      const time = dateMatch[4];

      let status = '';
      let location = '';

      // line before date could be status or location
      const prev = i >= 1 ? lines[i - 1] : '';
      const prevPrev = i >= 2 ? lines[i - 2] : '';

      // prev is location (all caps), prevPrev is status
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
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }

  return results;
}
