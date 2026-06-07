import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://www.fedex.com/fedextrack';

async function scrapePage(
  page: import('puppeteer').Page,
  trackingNumber: string
): Promise<import('./usps').TrackingResult> {
  await page.goto(`${TRACK_URL}/?trknbr=${encodeURIComponent(trackingNumber)}`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await new Promise((r) => setTimeout(r, 4000));

  const data = await page.evaluate(() => {
    const body = document.body.innerText;

    const descriptions = [
      'Your package has been delivered',
      'Your package is scheduled',
      'Your package is out for delivery',
      'Your package is in transit',
      'Your package is at',
      'Delay',
      'Delivery exception',
      'Clearance delay',
      'Shipment information sent to FedEx',
      'Picked up',
      'In FedEx possession',
      'Tendered',
      'International shipment release',
      'Arrived at FedEx location',
      'Departed FedEx location',
      'At destination sort facility',
      'At local FedEx facility',
      'On FedEx vehicle for delivery',
      'Schedule delivery',
      'Delivery option requested',
      'Package available for',
    ];
    let description = '';
    for (const prefix of descriptions) {
      const descMatch = body.match(
        new RegExp(
          `(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?\\.)`,
          'i'
        )
      );
      if (descMatch) {
        description = descMatch[0].trim();
        break;
      }
    }

    if (!description) {
      const lines = body.split('\n').filter(Boolean);
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        if (
          /delivered|in transit|out for delivery|picked up|exception|clearance delay/i.test(
            lines[i]
          )
        ) {
          description = lines[i].trim();
          break;
        }
      }
    }

    const knownStatuses = new Set([
      'Delivered',
      'Out for delivery',
      'In transit',
      'At local FedEx facility',
      'At destination sort facility',
      'Arrived at FedEx location',
      'Departed FedEx location',
      'Shipment information sent to FedEx',
      'Picked up',
      'In FedEx possession',
      'Tendered',
      'International shipment release',
      'Clearance delay',
      'Delivery exception',
      'On FedEx vehicle for delivery',
      'Delivery option requested',
      'Schedule delivery pending',
      'At FedEx destination facility',
      'Package available for clearance',
      'Delay',
      'Operational delay',
      'Weather delay',
    ]);

    const dateRe =
      /^(?:[A-Z][a-z]{2,8}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i;
    const dateRe2 = /^\d{1,2}\/\d{1,2}\/\d{4}/;
    const timeRe = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)/;

    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const events: Array<{
      status: string;
      detail: string;
      location: string;
      date: string;
      time: string;
    }> = [];

    let i = 0;
    while (i < lines.length) {
      const dateMatch = lines[i].match(dateRe) || lines[i].match(dateRe2);
      if (!dateMatch) {
        i++;
        continue;
      }

      let date = lines[i];
      let time = '';
      let status = '';
      let location = '';

      if (i + 1 < lines.length && timeRe.test(lines[i + 1])) {
        time = lines[i + 1].trim();
        i++;
      }

      const nextIdx = i + 1;
      if (nextIdx < lines.length) {
        const candidate = lines[nextIdx];
        if (knownStatuses.has(candidate)) {
          status = candidate;
          i++;
          const locIdx = i + 1;
          if (
            locIdx < lines.length &&
            /^[A-Z][A-Z\s,.-]+$/.test(lines[locIdx]) &&
            !knownStatuses.has(lines[locIdx]) &&
            !dateRe.test(lines[locIdx]) &&
            !dateRe2.test(lines[locIdx]) &&
            !timeRe.test(lines[locIdx])
          ) {
            location = lines[locIdx];
            i++;
          }
        } else if (
          /^[A-Z][A-Z\s,.-]+$/.test(candidate) &&
          !knownStatuses.has(candidate) &&
          !dateRe.test(candidate) &&
          !dateRe2.test(candidate)
        ) {
          location = candidate;
          i++;
        }
      }

      if (status || location) {
        events.push({
          status: status || 'Unknown',
          detail: status || 'Unknown',
          location,
          date,
          time,
        });
      }

      i++;
    }

    // Fallback: extract single event from description
    if (events.length === 0 && description) {
      let d = '';
      let t = '';
      let loc = '';

      const fmt1 = description.match(
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:AM|PM))/i
      );
      const fmt2 = description.match(
        /(?:as of|on)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i
      );
      const fmt3 = description.match(
        /(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(?:on\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i
      );

      if (fmt1) {
        d = fmt1[1] + ' ' + fmt1[2] + ', ' + fmt1[3];
        t = fmt1[4].toUpperCase();
      } else if (fmt2) {
        d = fmt2[1] + ' ' + fmt2[2] + ', ' + fmt2[3];
      } else if (fmt3) {
        d = fmt3[2] + ' ' + fmt3[3] + ', ' + fmt3[4];
        t = fmt3[1].toUpperCase();
      } else {
        const dateMatch = description.match(
          /\d{1,2}\/\d{1,2}\/\d{4}/
        );
        if (dateMatch) d = dateMatch[0];
        const timeMatch = description.match(
          /\d{1,2}:\d{2}\s*(?:AM|PM)/i
        );
        if (timeMatch) t = timeMatch[0].toUpperCase();
      }

      const locMatch = description.match(
        /(?:in|at)\s+([A-Z][A-Z\s,]+(?:[A-Z]{2})?(?:\s+\d{5})?)(?:\.|$|\s+on)/i
      );
      if (locMatch) loc = locMatch[1].trim();

      if (d) {
        const statusMatch = description.match(
          /^(Your package|Delivery|Shipment|Delay|Clearance|Operational|Weather|International|In transit|Out for delivery|Picked up|Tendered)/i
        );
        const st = statusMatch ? statusMatch[0] : 'In transit';
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

export async function checkFedExTracking(
  trackingNumbers: string[]
): Promise<import('./usps').TrackingResult[]> {
  if (trackingNumbers.length === 0) return [];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const results: import('./usps').TrackingResult[] = [];

  try {
    for (const tn of trackingNumbers) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 800 });
        const result = await scrapePage(page, tn);
        results.push(result);
      } catch (err: any) {
        console.error(`FedEx scrape error for ${tn}:`, err.message);
        results.push({ trackingNumber: tn, summary: '', events: [] });
      } finally {
        await page.close();
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    await browser.close();
  }

  return results;
}
