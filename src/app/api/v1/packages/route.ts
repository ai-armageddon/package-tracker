import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await prisma.trackingItem.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      trackingNumber: true,
      carrier: true,
      title: true,
      note: true,
      lastStatus: true,
      lastDetail: true,
      lastLocation: true,
      lastStatusDate: true,
      active: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    count: items.length,
    packages: items.map((p, i) => ({ index: i + 1, ...p })),
  });
}
