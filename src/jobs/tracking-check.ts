import { prisma } from '@/lib/db/prisma';
import { checkTracking } from '@/lib/services/usps';
import { sendBatchNotification } from '@/lib/services/telegram';

const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL_MINUTES) || 15;

function shouldCheck(intervalMinutes: number): boolean {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  return seconds < 60 && minutes % intervalMinutes === 0;
}

export async function runTrackingCheck() {
  const interval = CHECK_INTERVAL;

  console.log(`[${new Date().toISOString()}] Running tracking check...`);

  const activeItems = await prisma.trackingItem.findMany({
    where: { active: true },
  });

  if (activeItems.length === 0) {
    console.log('No active tracking items.');
    return;
  }

  const numbers = activeItems.map((i) => i.trackingNumber);

  let results;
  try {
    results = await checkTracking(numbers);
  } catch (err) {
    console.error('USPS API error:', err);
    return;
  }

  const updates: any[] = [];

  for (const result of results) {
    const item = activeItems.find((i) => i.trackingNumber === result.trackingNumber);
    if (!item) continue;

    const latestEvent = result.events[0];
    if (!latestEvent) continue;

    // Normalize scraped date to ISO for comparison with stored DB date
    const scrapedIsoDate = latestEvent.date
      ? new Date(latestEvent.date).toISOString().slice(0, 10)
      : '';
    const storedIsoDate = item.lastStatusDate
      ? new Date(item.lastStatusDate).toISOString().slice(0, 10)
      : '';

    const eventKey = `${latestEvent.status}|${latestEvent.detail}|${scrapedIsoDate}|${latestEvent.time}`;
    const currentKey = `${item.lastStatus}|${item.lastDetail}|${storedIsoDate}`;
    const hadPriorStatus = !!item.lastStatus;
    const statusChanged = eventKey !== currentKey;

    // Always save latest to DB
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

    // Only notify if we HAD a prior status AND it changed
    if (hadPriorStatus && statusChanged && latestEvent.status) {
      updates.push({
        trackingNumber: result.trackingNumber,
        title: item.title,
        status: latestEvent.status,
        detail: latestEvent.detail,
        location: latestEvent.location,
        date: latestEvent.date,
        time: latestEvent.time,
      });
    }
  }

  if (updates.length > 0) {
    await sendBatchNotification(updates);
    console.log(`Sent notifications for ${updates.length} updates.`);
  } else {
    console.log('No status changes detected.');
  }
}

export function startScheduler() {
  console.log(
    `Tracking check scheduler running every minute (fires at ${CHECK_INTERVAL}-minute intervals).`
  );

  setInterval(() => {
    if (!shouldCheck(CHECK_INTERVAL)) return;
    runTrackingCheck().catch((err) =>
      console.error('Scheduler error:', err)
    );
  }, 60_000);

  console.log('Running initial check...');
  runTrackingCheck().catch((err) => console.error('Initial check error:', err));
}
