import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { title, note, active } = body;

  const existing = await prisma.trackingItem.findUnique({
    where: { id: params.id },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const data: any = {};
  if (title !== undefined) data.title = title;
  if (note !== undefined) data.note = note;
  if (active !== undefined) data.active = active;

  const updated = await prisma.trackingItem.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const existing = await prisma.trackingItem.findUnique({
    where: { id: params.id },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.trackingItem.delete({ where: { id: params.id } });

  return NextResponse.json({ deleted: true });
}
