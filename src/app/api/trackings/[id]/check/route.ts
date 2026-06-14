import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { checkAndSaveTrackingItem } from '@/lib/services/tracking';

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

  await checkAndSaveTrackingItem(item);

  const updated = await prisma.trackingItem.findUnique({
    where: { id: item.id },
  });

  return NextResponse.json(updated);
}

export const dynamic = 'force-dynamic';
