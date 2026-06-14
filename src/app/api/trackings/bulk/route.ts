import { NextRequest, NextResponse } from 'next/server';
import {
  parseBulkTrackingInput,
  parseBulkTrackingValue,
  type BulkTrackingParseResult,
} from '@/lib/services/bulk-tracking-import';
import { createTrackingItem } from '@/lib/services/tracking-items';

const MAX_BULK_IMPORT_ITEMS = 200;

interface BulkImportRow {
  row: number;
  status: 'created' | 'skipped' | 'failed';
  trackingNumber: string;
  carrier: string | null;
  error?: string;
  item?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRequestBody(body: unknown): BulkTrackingParseResult {
  if (typeof body === 'string') return parseBulkTrackingInput(body);

  if (isRecord(body) && typeof body.input === 'string') {
    return parseBulkTrackingInput(body.input);
  }

  if (isRecord(body) && 'items' in body) {
    return parseBulkTrackingValue(body.items);
  }

  return parseBulkTrackingValue(body);
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await request.json()
      : await request.text();
    const parsed = parseRequestBody(body);
    const overLimit = parsed.items.length > MAX_BULK_IMPORT_ITEMS;
    const items = parsed.items.slice(0, MAX_BULK_IMPORT_ITEMS);
    const results: BulkImportRow[] = [];

    for (const [index, item] of items.entries()) {
      const result = await createTrackingItem(item, { checkInitial: false });
      const row = item.sourceLine ?? index + 1;

      if (result.ok) {
        results.push({
          row,
          status: 'created',
          trackingNumber: result.trackingNumber,
          carrier: result.carrier,
          item: result.item,
        });
        continue;
      }

      results.push({
        row,
        status: result.status === 409 ? 'skipped' : 'failed',
        trackingNumber: result.trackingNumber ?? item.trackingNumber,
        carrier: result.carrier ?? item.carrier ?? null,
        error: result.error,
      });
    }

    const parseIssues = [
      ...parsed.issues,
      ...(overLimit
        ? [{
            row: MAX_BULK_IMPORT_ITEMS + 1,
            message: `Only the first ${MAX_BULK_IMPORT_ITEMS} entries were imported`,
          }]
        : []),
    ];
    const imported = results.filter((result) => result.status === 'created').length;
    const skipped = results.filter((result) => result.status === 'skipped').length;
    const rowFailures = results.filter((result) => result.status === 'failed').length;
    const failed = rowFailures + parseIssues.length;

    if (items.length === 0) {
      return NextResponse.json({
        imported,
        skipped,
        failed,
        parseIssues,
        results,
      }, { status: 400 });
    }

    return NextResponse.json({
      imported,
      skipped,
      failed,
      parseIssues,
      results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
