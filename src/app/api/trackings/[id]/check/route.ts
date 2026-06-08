import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { checkTracking } from '@/lib/services/usps';
import { checkFedExTracking } from '@/lib/services/fedex';
import type { Carrier } from '@/lib/services/carriers';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const item = await prisma.trackingItem.findUnique({
    where: { id: params.id },
  });

  if (!item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const scraper = item.carrier === 'FedEx' ? checkFedExTracking : checkTracking;
  const results = await scraper([item.trackingNumber]);
  const result = results[0];

  if (result && result.events.length > 0) {
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
  }

  const updated = await prisma.trackingItem.findUnique({
    where: { id: item.id },
  });

  return NextResponse.json(updated);
}

export const dynamic = 'force-dynamic';
