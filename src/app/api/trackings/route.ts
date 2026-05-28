import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  try {
    const items = await prisma.trackingItem.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(items);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trackingNumber, title, note } = body;

    if (!trackingNumber || typeof trackingNumber !== 'string') {
      return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
    }

    const cleaned = trackingNumber.trim().toUpperCase();

    const existing = await prisma.trackingItem.findUnique({
      where: { trackingNumber: cleaned },
    });

    if (existing) {
      return NextResponse.json({ error: 'Tracking number already exists' }, { status: 409 });
    }

    const item = await prisma.trackingItem.create({
      data: {
        trackingNumber: cleaned,
        title: title || null,
        note: note || null,
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
