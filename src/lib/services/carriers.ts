export const CARRIERS = ["USPS", "FedEx", "UPS", "UniUni"] as const;
export type Carrier = (typeof CARRIERS)[number];

export function normalizeTrackingNumber(tn: string): string {
  return tn.replace(/[\s-]+/g, "").toUpperCase();
}

export function isCarrier(value: string): value is Carrier {
  return CARRIERS.includes(value as Carrier);
}

export function isUspsInternationalTrackingNumber(tn: string): boolean {
  const cleaned = normalizeTrackingNumber(tn);
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cleaned);
}

function isUpsTrackingNumber(tn: string): boolean {
  const cleaned = normalizeTrackingNumber(tn);
  return (
    /^1Z[0-9A-Z]{16}$/.test(cleaned) ||
    /^T\d{10}$/.test(cleaned) ||
    /^\d{9}$/.test(cleaned) ||
    /^\d{12}$/.test(cleaned) ||
    /^\d{18}$/.test(cleaned) ||
    /^MI\d{6}[0-9A-Z]{1,22}$/.test(cleaned)
  );
}

function isDistinctUpsTrackingNumber(tn: string): boolean {
  const cleaned = normalizeTrackingNumber(tn);
  return (
    /^1Z[0-9A-Z]{16}$/.test(cleaned) ||
    /^T\d{10}$/.test(cleaned) ||
    /^\d{9}$/.test(cleaned) ||
    /^MI\d{6}[0-9A-Z]{1,22}$/.test(cleaned)
  );
}

export interface CarrierConfig {
  name: string;
  trackingUrl: (tn: string) => string;
  homeUrl: string;
  favicon: string;
  validate: (tn: string) => boolean;
}

export const CARRIER_CONFIG: Record<Carrier, CarrierConfig> = {
  USPS: {
    name: "USPS",
    trackingUrl: (tn) =>
      `https://tools.usps.com/tracking/${encodeURIComponent(tn)}`,
    homeUrl: "https://www.usps.com",
    favicon: "https://www.usps.com/favicon.ico",
    validate: (tn) => {
      const cleaned = normalizeTrackingNumber(tn);
      return (
        /^\d{20,22}$/.test(cleaned) ||
        isUspsInternationalTrackingNumber(cleaned)
      );
    },
  },
  FedEx: {
    name: "FedEx",
    trackingUrl: (tn) =>
      `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`,
    homeUrl: "https://www.fedex.com",
    favicon: "https://www.fedex.com/favicon.ico",
    validate: (tn) => {
      const cleaned = normalizeTrackingNumber(tn);
      return /^\d{12,22}$/.test(cleaned) || /^DT\d{12}$/.test(cleaned);
    },
  },
  UPS: {
    name: "UPS",
    trackingUrl: (tn) =>
      `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(tn)}&loc=en_US&requester=ST%2Ftrackdetails`,
    homeUrl: "https://www.ups.com",
    favicon: "https://www.ups.com/favicon.ico",
    validate: isUpsTrackingNumber,
  },
  UniUni: {
    name: "UniUni",
    trackingUrl: (tn) =>
      `https://www.uniuni.com/tracking/?no=${encodeURIComponent(tn)}`,
    homeUrl: "https://www.uniuni.com",
    favicon: "https://www.uniuni.com/favicon.ico",
    // UniUni does not publish one fixed tracking-number format. Keep explicit
    // selection permissive while auto-detection below stays prefix-based.
    validate: (tn) => /^[0-9A-Z]{8,40}$/.test(normalizeTrackingNumber(tn)),
  },
};

export function detectCarrier(tn: string): Carrier | null {
  const cleaned = normalizeTrackingNumber(tn);
  if (/^UUS[0-9A-Z]{8,37}$/.test(cleaned)) return "UniUni";
  if (isDistinctUpsTrackingNumber(cleaned)) return "UPS";
  if (CARRIER_CONFIG.USPS.validate(cleaned)) return "USPS";
  if (CARRIER_CONFIG.FedEx.validate(cleaned)) return "FedEx";
  return null;
}

export function resolveCarrier(
  carrierHint: string | null,
  tn: string,
): Carrier | null {
  const hint = carrierHint?.trim().toLowerCase();
  if (hint === "usps" || hint === "u") return "USPS";
  if (hint === "fedex" || hint === "f" || hint === "fx") return "FedEx";
  if (hint === "ups" || hint === "u.p.s.") return "UPS";
  if (hint === "uniuni" || hint === "uni uni" || hint === "uni" || hint === "uus") {
    return "UniUni";
  }
  return detectCarrier(tn);
}

export function getCarrierTrackingUrl(carrier: string, tn: string): string {
  const knownCarrier = isCarrier(carrier) ? carrier : "USPS";
  return CARRIER_CONFIG[knownCarrier].trackingUrl(tn);
}
