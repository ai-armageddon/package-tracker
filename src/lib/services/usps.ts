import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://tools.usps.com/go/TrackConfirmAction';

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
  await page.goto(`${TRACK_URL}?tLabels=${encodeURIComponent(trackingNumber)}`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  // Wait for tracking data to render
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.tracking-number, .tracking-status, [class*="tracking"]');
        return !!el;
      },
      { timeout: 15000 }
    );
  } catch {
    // Page might have loaded but with no tracking events yet
  }

  // Extract tracking events from the page
  const data = await page.evaluate(() => {
    const events: Array<{ status: string; detail: string; location: string; date: string; time: string }> = [];
    let summary = '';

    // Try to find the tracking summary/status
    const statusEl =
      document.querySelector('.delivery_status') ||
      document.querySelector('[class*="status"]') ||
      document.querySelector('strong');
    summary = statusEl?.textContent?.trim() || '';

    // Try table-based tracking history
    const rows = document.querySelectorAll('table tbody tr, .tracking-history tr, [class*="tracking-history"] tr');
    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 3) {
        const date = cells[0]?.textContent?.trim() || '';
        const time = cells[1]?.textContent?.trim() || '';
        const status = cells[2]?.textContent?.trim() || '';
        const location = cells[3]?.textContent?.trim() || '';
        if (status) {
          events.push({ status, detail: status, location, date, time });
        }
      }
    });

    // Fallback: try to find tracking data in page text
    if (events.length === 0) {
      const pageText = document.body?.innerText || '';

      // Look for common USPS tracking patterns
      const trackingSection = pageText.match(
        /Tracking History[\s\S]*?(?=See Less|Track Another|$)/i
      );
      if (trackingSection) {
        const lines = trackingSection[0].split('\n').filter(Boolean);
        for (const line of lines) {
          const match = line.match(
            /^(\w+ \d+, \d{4})\s*,?\s*(\d{1,2}:\d{2}\s*(?:am|pm))\s+(.+)$/i
          );
          if (match) {
            events.push({
              date: match[1],
              time: match[2],
              status: match[3].trim(),
              detail: match[3].trim(),
              location: '',
            });
          }
        }
      }
    }

    return { summary, events };
  });

  return {
    trackingNumber,
    summary: data.summary || 'Unknown',
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
        // Set realistic viewport and user agent
        await page.setViewport({ width: 1280, height: 800 });
        const result = await scrapePage(page, tn);
        results.push(result);
      } catch (err: any) {
        console.error(`USPS scrape error for ${tn}:`, err.message);
        results.push({ trackingNumber: tn, summary: '', events: [] });
      } finally {
        await page.close();
      }

      // Be polite — small delay between pages
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }

  return results;
}
