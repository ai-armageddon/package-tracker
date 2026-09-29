import type { TrackingItem } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  CARRIER_CONFIG,
  detectCarrier,
  normalizeTrackingNumber,
  resolveCarrier,
  type Carrier,
} from "@/lib/services/carriers";
import { checkAndSaveTrackingItem } from "@/lib/services/tracking";

export interface CreateTrackingItemInput {
  trackingNumber: unknown;
  carrier?: unknown;
  title?: unknown;
  note?: unknown;
}

export type CreateTrackingItemResult =
  | {
      ok: true;
      item: TrackingItem;
      carrier: Carrier;
      trackingNumber: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      carrier?: Carrier;
      trackingNumber?: string;
    };

export interface CreateTrackingItemOptions {
  checkInitial?: boolean;
}

function detectCarrierForLooseInput(tn: string): Carrier | null {
  const cleaned = normalizeTrackingNumber(tn);
  if (!cleaned) return null;

  if (/^UUS[0-9A-Z]{0,37}$/.test(cleaned)) {
    return "UniUni";
  }

  if (
    /^1Z[0-9A-Z]{0,16}$/.test(cleaned) ||
    /^T\d{0,10}$/.test(cleaned) ||
    /^\d{9}$/.test(cleaned) ||
    /^\d{12}$/.test(cleaned) ||
    /^MI[0-9A-Z]{0,28}$/.test(cleaned)
  ) {
    return "UPS";
  }

  return detectCarrier(cleaned);
}

function optionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function resolveTrackingCarrier(carrier: unknown, cleaned: string): Carrier {
  const carrierHint = optionalText(carrier);
  return (
    (carrierHint
      ? resolveCarrier(carrierHint, cleaned)
      : detectCarrierForLooseInput(cleaned)) || "USPS"
  );
}

export async function createTrackingItem(
  input: CreateTrackingItemInput,
  options: CreateTrackingItemOptions = {},
): Promise<CreateTrackingItemResult> {
  if (typeof input.trackingNumber !== "string") {
    return { ok: false, status: 400, error: "trackingNumber is required" };
  }

  const cleaned = normalizeTrackingNumber(input.trackingNumber);
  if (!cleaned) {
    return { ok: false, status: 400, error: "trackingNumber is required" };
  }

  const resolvedCarrier = resolveTrackingCarrier(input.carrier, cleaned);

  if (!CARRIER_CONFIG[resolvedCarrier].validate(cleaned)) {
    return {
      ok: false,
      status: 400,
      error: `Invalid ${resolvedCarrier} tracking number format`,
      carrier: resolvedCarrier,
      trackingNumber: cleaned,
    };
  }

  const existing = await prisma.trackingItem.findFirst({
    where: { trackingNumber: cleaned, carrier: resolvedCarrier },
  });

  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "Tracking number already exists for this carrier",
      carrier: resolvedCarrier,
      trackingNumber: cleaned,
    };
  }

  const item = await prisma.trackingItem.create({
    data: {
      trackingNumber: cleaned,
      carrier: resolvedCarrier,
      title: optionalText(input.title),
      note: optionalText(input.note),
    },
  });

  if (options.checkInitial ?? true) {
    try {
      await checkAndSaveTrackingItem(item);
    } catch (err) {
      console.error(
        `Initial ${resolvedCarrier} tracking scrape failed for ${cleaned}:`,
        err,
      );
    }
  }

  const updated = await prisma.trackingItem.findUnique({
    where: { id: item.id },
  });

  return {
    ok: true,
    item: updated ?? item,
    carrier: resolvedCarrier,
    trackingNumber: cleaned,
  };
}
