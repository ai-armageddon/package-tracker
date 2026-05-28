import { NextResponse } from 'next/server';
import { runTrackingCheck } from '@/jobs/tracking-check';

export async function POST() {
  try {
    await runTrackingCheck();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
