import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';

puppeteer.use(StealthPlugin());

const TRACK_URL = 'https://www.fedex.com/fedextrack';
const DEBUG_DIR = '/tmp/fedex-debug';
const TRACKING_INPUT_SELECTOR =
  'input[id^="tracking_number_"], textarea[id^="tracking_number_"], input[name="trackingNumber"], textarea[name="trackingNumber"]';
const FEDEX_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForVisibleTrackingInput(page: import('puppeteer').Page) {
  await page.waitForFunction(
    (selector) => {
      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          !(el as HTMLInputElement).disabled
        );
      };

      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    },
    { timeout: 15000 },
    TRACKING_INPUT_SELECTOR
  );

  const inputs = await page.$$(TRACKING_INPUT_SELECTOR);
  for (const input of inputs) {
    const box = await input.boundingBox();
    const isUsable = await input.evaluate((el) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      return type !== 'hidden' && !(el as HTMLInputElement).disabled;
    });
    if (box && isUsable) return input;
  }

  throw new Error('FedEx tracking input was not visible');
}

async function submitTrackingForm(page: import('puppeteer').Page): Promise<boolean> {
  return page.evaluate(() => {
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

    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[type="submit"], button')
    ).find((btn) => {
      const text = (btn.textContent || '').trim();
      return /^track$/i.test(text) && isVisible(btn) && !btn.disabled;
    });

    if (!button) return false;
    button.click();
    return true;
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function shouldRetryHeadful(result: import('./usps').TrackingResult): boolean {
  if (result.events.length === 0) return true;
  return result.events.some((event) => event.status === 'Tracking number not found');
}

async function scrapePage(
  page: import('puppeteer').Page,
  trackingNumber: string
): Promise<import('./usps').TrackingResult> {
  const url = `${TRACK_URL}/`;
  console.log(`[FedEx] Navigating to: ${url}`);
  let sawTrackingApiHtmlResponse = false;
  const responseHandler = (response: import('puppeteer').HTTPResponse) => {
    if (!response.url().includes('api.fedex.com/track/v2/shipments')) return;
    const contentType = response.headers()['content-type'] || '';
    if (/text\/html/i.test(contentType)) {
      sawTrackingApiHtmlResponse = true;
    }
  };
  page.on('response', responseHandler);

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await delay(4000);
    await clickVisibleByText(page, /^(accept all cookies|reject optional cookies)$/i);

    const openedForm = await clickVisibleByText(page, /^track another shipment$/i);
    if (openedForm) await delay(1500);

    const trackingInput = await waitForVisibleTrackingInput(page);
    await trackingInput.click({ count: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(trackingNumber, { delay: 25 });

    try {
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"], button')).some(
            (btn) => {
              const rect = btn.getBoundingClientRect();
              return (
                /^track$/i.test((btn.textContent || '').trim()) &&
                rect.width > 0 &&
                rect.height > 0 &&
                !btn.disabled
              );
            }
          ),
        { timeout: 10000 }
      );
    } catch {
      console.warn('[FedEx] Track button did not become enabled before submit');
    }

    const submitted = await submitTrackingForm(page);
    if (!submitted) {
      await page.keyboard.press('Enter');
    }

    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
      page
        .waitForFunction(
          (tn) => {
            const text = document.body.innerText || '';
            return (
              text.includes(tn) ||
              /travel history|shipment facts|we can.t find|delivery details|status details|delivered|in transit|out for delivery|delivery exception/i.test(
                text
              )
            );
          },
          { timeout: 30000 },
          trackingNumber
        )
        .catch(() => null),
    ]);

    await delay(3000);
    const preExpandText = await page.evaluate(() => document.body.innerText || '');
    const expandedDetails = await clickVisibleByText(page, /^view more details$/i);
    if (expandedDetails) await delay(2000);

    const bodyText = await page.evaluate(() => document.body.innerText);
    const textContent = await page.evaluate(() => document.body.textContent || '');
    const combinedText = [preExpandText, bodyText].filter(Boolean).join('\n');
    const finalText = combinedText.trim().length > 100 ? combinedText : textContent;

    console.log(`[FedEx] Text length: innerText=${bodyText.length}, textContent=${textContent.length}`);
    console.log(`[FedEx] Text preview (first 800 chars):\n${finalText.substring(0, 800)}`);

    // Save debug snapshot
    try {
      if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const snapshot = {
        url: page.url(),
        timestamp: new Date().toISOString(),
        innerTextLength: bodyText.length,
        textContentLength: textContent.length,
        text: finalText,
      };
      const baseName = `${trackingNumber}-${Date.now()}`;
      const jsonFile = path.join(DEBUG_DIR, `${baseName}.json`);
      const screenshotFile = path.join(DEBUG_DIR, `${baseName}.png`);
      const htmlFile = path.join(DEBUG_DIR, `${baseName}.html`);

      fs.writeFileSync(jsonFile, JSON.stringify(snapshot, null, 2));
      await page.screenshot({ path: screenshotFile, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(htmlFile, html);

      console.log(`[FedEx] Debug files saved:`);
      console.log(`[FedEx]   Screenshot: ${screenshotFile}`);
      console.log(`[FedEx]   JSON:      ${jsonFile}`);
      console.log(`[FedEx]   HTML:      ${htmlFile}`);
    } catch (e) {
      console.warn('[FedEx] Could not save debug snapshot:', e);
    }

    const data = await page.evaluate((capturedText) => {
    const body = document.body;
    const innerText = body.innerText || '';
    const textContent = body.textContent || '';
    const visibleText = [capturedText, innerText].filter(Boolean).join('\n');
    const bodyText = visibleText.trim().length > 100 ? visibleText : textContent;
    const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

    // Detect if we're on a challenge/access denied page
    if (/access denied|blocked|permission denied|captcha|verify you are human|unusual traffic/i.test(bodyText)) {
      return { description: '', events: [], blocked: true };
    }

    const notFoundMatch = bodyText.match(/we can.t find that tracking number[^\n.]*(?:\.[^\n.]*)?/i);

    const descriptions = [
      'Your package has been delivered',
      'Your package is scheduled',
      'Your package is out for delivery',
      'Your package is in transit',
      'Your package is still',
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
      'Arrived at FedEx hub',
      'Departed FedEx location',
      'Departed FedEx hub',
      'Left FedEx origin facility',
      'At destination sort facility',
      'At local FedEx facility',
      'On FedEx vehicle for delivery',
      'Schedule delivery',
      'Delivery option requested',
      'Package available for',
    ];
    let description = '';
    if (notFoundMatch) {
      description = normalizeWhitespace(notFoundMatch[0]);
    }
    for (const prefix of descriptions) {
      if (description) break;
      const descMatch = bodyText.match(
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
      const lines = bodyText.split('\n').map((l: string) => l.trim()).filter(Boolean);
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

    if (
      description.length > 300 ||
      /travel history|shipment facts|tracking number|shipment overview/i.test(description)
    ) {
      description = '';
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
      'Left FedEx origin facility',
      'Arrived at FedEx hub',
      'Departed FedEx hub',
      'On the way',
      'We have your package',
      'At FedEx destination facility',
      'Package available for clearance',
      'Delay',
      'Operational delay',
      'Weather delay',
    ]);

    const dateRe =
      /^(?:[A-Z][a-z]{2,8}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})/i;
    const dateRe2 = /^(?:[A-Z][a-z]+,\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})/;
    const timeRe = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)/;
    const locationRe =
      /^[A-Z][A-Z\s.'-]+,\s*[A-Z]{2}(?:\s+[A-Z]{2})?(?:\s+\d{5})?$|^[A-Z][A-Z\s.'-]+\s+[A-Z]{2}$/;
    const noiseRe =
      /^(travel history|shipment facts|local scan time|help|need help\?|track|tracking number|date or time|status|details|view more details|more options|get updates)$/i;

    const lines = bodyText
      .split('\n')
      .map((l: string) => normalizeWhitespace(l))
      .filter(Boolean);

    const events: Array<{
      status: string;
      detail: string;
      location: string;
      date: string;
      time: string;
    }> = [];

    const isLikelyStatus = (line: string) =>
      knownStatuses.has(line) ||
      /shipment information|picked up|arrived|departed|left fedex|on the way|out for delivery|delivery|delay|exception|in transit|tendered|release|available/i.test(
        line
      );

    let currentDate = '';
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const shortDateMatch = line.match(dateRe2);
      const longDateMatch = line.match(dateRe);
      if (shortDateMatch || longDateMatch) {
        currentDate = shortDateMatch ? shortDateMatch[1] : line.replace(timeRe, '').trim();
        const sameLineTime = line.match(timeRe)?.[0]?.toUpperCase();
        if (!sameLineTime) continue;
      }

      if (!currentDate || !timeRe.test(line)) continue;

      const status = lines[lineIdx + 1] || '';
      if (!status || !isLikelyStatus(status) || noiseRe.test(status)) continue;

      const locationCandidate = lines[lineIdx + 2] || '';
      const location = locationRe.test(locationCandidate) ? locationCandidate : '';
      events.push({
        status,
        detail: description || status,
        location,
        date: currentDate,
        time: line.match(timeRe)?.[0]?.toUpperCase() || line,
      });
    }

    if (events.length === 0) {
      let i = 0;
      while (i < lines.length) {
        const dateMatch = lines[i].match(dateRe) || lines[i].match(dateRe2);
        if (!dateMatch) {
          i++;
          continue;
        }

        let date = lines[i].replace(timeRe, '').trim();
        let time = lines[i].match(timeRe)?.[0]?.toUpperCase() || '';
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
              locationRe.test(lines[locIdx]) &&
              !knownStatuses.has(lines[locIdx]) &&
              !dateRe.test(lines[locIdx]) &&
              !dateRe2.test(lines[locIdx]) &&
              !timeRe.test(lines[locIdx])
            ) {
              location = lines[locIdx];
              i++;
            }
          } else if (
            locationRe.test(candidate) &&
            !knownStatuses.has(candidate) &&
            !dateRe.test(candidate) &&
            !dateRe2.test(candidate)
          ) {
            location = candidate;
            i++;
          }
        }

        if (!status && i >= 1) {
          const prev = lines[i - 1];
          const prevPrev = i >= 2 ? lines[i - 2] : '';

          if (knownStatuses.has(prev)) {
            status = prev;
          } else if (locationRe.test(prev) && knownStatuses.has(prevPrev)) {
            status = prevPrev;
            location = prev;
          }
        }

        if (status || location) {
          const detailLines: string[] = [];
          for (let detailIdx = i + 1; detailIdx < lines.length; detailIdx++) {
            const line = lines[detailIdx];
            if (dateRe.test(line) || dateRe2.test(line) || timeRe.test(line)) break;
            if (knownStatuses.has(line) || noiseRe.test(line)) break;
            if (location && line === location) continue;
            if (locationRe.test(line)) break;
            detailLines.push(line);
          }

          const detail =
            detailLines.length > 0 ? detailLines.join(' ') : description || status || 'Unknown';
          events.push({
            status: status || 'Unknown',
            detail,
            location,
            date: lines[i].match(dateRe2)?.[1] || date,
            time,
          });
        }

        i++;
      }
    }

    // Fallback: extract single event from description
    if (events.length === 0 && description) {
      if (/we can.t find that tracking number/i.test(description)) {
        events.push({
          status: 'Tracking number not found',
          detail: description,
          location: '',
          date: '',
          time: '',
        });
        return { description, events };
      }

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
        events.push({ status: st, detail: description, location: loc, date: d, time: t });
      }
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

    return { description, events: deduped };
    }, preExpandText);

    const result = {
      trackingNumber,
      summary: data.description || data.events[0]?.detail || data.events[0]?.status || 'Unknown',
      events: data.events,
    };
    const renderedRealTrackingPage =
      finalText.includes(trackingNumber) &&
      /tracking id|travel history|shipment facts|delivery details/i.test(finalText);

    if (sawTrackingApiHtmlResponse && !renderedRealTrackingPage && shouldRetryHeadful(result)) {
      console.warn('[FedEx] Tracking API returned HTML; likely anti-bot response.');
      return { trackingNumber, summary: 'FedEx anti-bot response', events: [] };
    }

    return result;
  } finally {
    page.off('response', responseHandler);
  }
}

async function launchFedExBrowser(headless: boolean) {
  return puppeteer.launch({
    headless,
    defaultViewport: headless ? undefined : null,
    args: [
      ...(headless ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=en-US,en',
      '--window-size=1365,900',
    ],
  });
}

async function scrapeNumbers(
  trackingNumbers: string[],
  headless: boolean
): Promise<import('./usps').TrackingResult[]> {
  const browser = await launchFedExBrowser(headless);

  const results: import('./usps').TrackingResult[] = [];

  try {
    for (const tn of trackingNumbers) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1365, height: 900 });
        await page.setUserAgent(FEDEX_USER_AGENT);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        const result = await scrapePage(page, tn);
        results.push(result);
      } catch (err: any) {
        console.error(`FedEx scrape error for ${tn}:`, err.message);
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

export async function checkFedExTracking(
  trackingNumbers: string[]
): Promise<import('./usps').TrackingResult[]> {
  if (trackingNumbers.length === 0) return [];

  const browserMode = process.env.FEDEX_BROWSER_MODE?.toLowerCase();
  const preferHeadful =
    browserMode === 'headful' || process.env.FEDEX_HEADLESS === 'false';
  const headfulFallback = process.env.FEDEX_HEADFUL_FALLBACK === 'true';
  const results = await scrapeNumbers(trackingNumbers, !preferHeadful);
  const retryNumbers = headfulFallback && !preferHeadful
    ? results.filter(shouldRetryHeadful).map((result) => result.trackingNumber)
    : [];

  if (retryNumbers.length === 0) return results;

  try {
    console.warn(`[FedEx] Retrying ${retryNumbers.length} package(s) in visible browser mode.`);
    const retryResults = await scrapeNumbers(retryNumbers, false);
    for (const retryResult of retryResults) {
      const index = results.findIndex(
        (result) => result.trackingNumber === retryResult.trackingNumber
      );
      if (index >= 0) results[index] = retryResult;
    }
  } catch (err: any) {
    console.error('[FedEx] Visible browser retry failed:', err.message);
  }

  return results;
}
