import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const item = await prisma.trackingItem.findUnique({
    where: { id: params.id },
    include: {
      statusHistory: {
        orderBy: [{ eventDate: 'desc' }, { eventTime: 'desc' }],
      },
    },
  });

  if (!item) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 });
  }

  return NextResponse.json(item);
}
