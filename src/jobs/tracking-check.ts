import { prisma } from '@/lib/db/prisma';
import { checkTracking } from '@/lib/services/usps';
import { checkFedExTracking } from '@/lib/services/fedex';
import { sendBatchNotification } from '@/lib/services/telegram';
import type { Carrier } from '@/lib/services/carriers';

const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL_MINUTES) || 15;
const RUN_INITIAL_CHECK = process.env.RUN_INITIAL_TRACKING_CHECK === 'true';
let schedulerStarted = false;

function shouldCheck(intervalMinutes: number): boolean {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  return seconds < 60 && minutes % intervalMinutes === 0;
}

async function checkCarrier(
  carrier: Carrier,
  items: Array<{
    id: string;
    trackingNumber: string;
    title: string | null;
    lastStatus: string | null;
    lastStatusDate: Date | null;
    lastDetail: string | null;
  }>
): Promise<{
  updates: Array<{
    trackingNumber: string;
    carrier: string;
    title: string | null;
    status: string;
    detail: string;
    location: string;
    date: string;
    time: string;
  }>;
  toDelete: string[];
}> {
  if (items.length === 0) return { updates: [], toDelete: [] };

  const numbers = items.map((i) => i.trackingNumber);
  const scraper = carrier === 'FedEx' ? checkFedExTracking : checkTracking;

  let results;
  try {
    results = await scraper(numbers);
  } catch (err) {
    console.error(`${carrier} tracking error:`, err);
    return { updates: [], toDelete: [] };
  }

  const updates: Array<{
    trackingNumber: string;
    carrier: string;
    title: string | null;
    status: string;
    detail: string;
    location: string;
    date: string;
    time: string;
  }> = [];
  const toDelete: string[] = [];

  for (const result of results) {
    const item = items.find((i) => i.trackingNumber === result.trackingNumber);
    if (!item) continue;

    const latestEvent = result.events[0];
    if (!latestEvent) continue;

    const scrapedIsoDate = latestEvent.date
      ? new Date(latestEvent.date).toISOString().slice(0, 10)
      : '';
    const storedIsoDate = item.lastStatusDate
      ? new Date(item.lastStatusDate).toISOString().slice(0, 10)
      : '';

    const eventKey = `${latestEvent.status}|${latestEvent.detail}|${scrapedIsoDate}`;
    const currentKey = `${item.lastStatus}|${item.lastDetail}|${storedIsoDate}`;
    const hadPriorStatus = !!item.lastStatus;
    const statusChanged = eventKey !== currentKey;

    if (statusChanged && latestEvent.status) {
      await prisma.trackingItem.update({
        where: { id: item.id },
        data: {
          lastStatus: latestEvent.status,
          lastDetail: latestEvent.detail,
          lastLocation: latestEvent.location || null,
          lastStatusDate: latestEvent.date ? new Date(latestEvent.date) : null,
        },
      });

      for (const event of result.events) {
        const exists = await prisma.statusHistory.findFirst({
          where: {
            trackingItemId: item.id,
            eventDate: event.date,
            eventTime: event.time,
            status: event.status,
          },
        });

        if (!exists) {
          await prisma.statusHistory.create({
            data: {
              trackingItemId: item.id,
              status: event.status,
              detail: event.detail,
              location: event.location || null,
              eventDate: event.date,
              eventTime: event.time,
            },
          });
        }
      }
    }

    if (hadPriorStatus && statusChanged && latestEvent.status) {
      updates.push({
        trackingNumber: result.trackingNumber,
        carrier,
        title: item.title,
        status: latestEvent.status,
        detail: latestEvent.detail,
        location: latestEvent.location,
        date: latestEvent.date,
        time: latestEvent.time,
      });

      if (/delivered/i.test(latestEvent.status)) {
        toDelete.push(item.id);
      }
    }
  }

  return { updates, toDelete };
}

export async function runTrackingCheck() {
  console.log(`[${new Date().toISOString()}] Running tracking check...`);

  const activeItems = await prisma.trackingItem.findMany({
    where: { active: true },
  });

  if (activeItems.length === 0) {
    console.log('No active tracking items.');
    return;
  }

  const byCarrier = {
    USPS: activeItems.filter((i) => i.carrier === 'USPS'),
    FedEx: activeItems.filter((i) => i.carrier === 'FedEx'),
  };

  const uspsResult = await checkCarrier('USPS', byCarrier.USPS);
  const fedExResult = await checkCarrier('FedEx', byCarrier.FedEx);

  const allUpdates = [...uspsResult.updates, ...fedExResult.updates];
  const allDeletes = [...uspsResult.toDelete, ...fedExResult.toDelete];

  if (allUpdates.length > 0) {
    await sendBatchNotification(allUpdates);
    console.log(`Sent notifications for ${allUpdates.length} updates.`);
  } else {
    console.log('No status changes detected.');
  }

  for (const id of allDeletes) {
    await prisma.trackingItem.delete({ where: { id } });
    console.log(`Auto-deleted delivered package ${id}`);
  }
}

export function startScheduler() {
  if (schedulerStarted) {
    console.log('Tracking check scheduler already running.');
    return;
  }

  schedulerStarted = true;

  console.log(
    `Tracking check scheduler running every minute (fires at ${CHECK_INTERVAL}-minute intervals).`
  );

  setInterval(() => {
    if (!shouldCheck(CHECK_INTERVAL)) return;
    runTrackingCheck().catch((err) =>
      console.error('Scheduler error:', err)
    );
  }, 60_000);

  if (RUN_INITIAL_CHECK) {
    console.log('Running initial check...');
    runTrackingCheck().catch((err) => console.error('Initial check error:', err));
  }
}
