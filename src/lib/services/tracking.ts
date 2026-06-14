import { prisma } from '@/lib/db/prisma';
import { isCarrier, type Carrier } from '@/lib/services/carriers';
import { checkFedExTracking } from '@/lib/services/fedex';
import { checkUpsTracking } from '@/lib/services/ups';
import { checkTracking, type TrackingResult } from '@/lib/services/usps';

type TrackingItemRef = {
  id: string;
  trackingNumber: string;
  carrier: string;
};

function getTrackingScraper(carrier: Carrier) {
  if (carrier === 'FedEx') return checkFedExTracking;
  if (carrier === 'UPS') return checkUpsTracking;
  return checkTracking;
}

export async function checkAndSaveTrackingItem(
  item: TrackingItemRef,
): Promise<TrackingResult | null> {
  const carrier = isCarrier(item.carrier) ? item.carrier : 'USPS';
  const scraper = getTrackingScraper(carrier);
  const results = await scraper([item.trackingNumber]);
  const result = results[0] ?? null;

  if (!result || result.events.length === 0) return result;

  const latest = result.events[0];

  await prisma.trackingItem.update({
    where: { id: item.id },
    data: {
      lastStatus: latest.status,
      lastDetail: latest.detail,
      lastLocation: latest.location || null,
      lastStatusDate: latest.date ? new Date(latest.date) : null,
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

  return result;
}
