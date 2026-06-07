export const CARRIERS = ['USPS', 'FedEx'] as const;
export type Carrier = (typeof CARRIERS)[number];

export interface CarrierConfig {
  name: string;
  trackingUrl: (tn: string) => string;
  homeUrl: string;
  favicon: string;
  validate: (tn: string) => boolean;
}

export const CARRIER_CONFIG: Record<Carrier, CarrierConfig> = {
  USPS: {
    name: 'USPS',
    trackingUrl: (tn) => `https://tools.usps.com/tracking/${encodeURIComponent(tn)}`,
    homeUrl: 'https://www.usps.com',
    favicon: 'https://www.usps.com/favicon.ico',
    validate: (tn) => /^\d{20,22}$/.test(tn),
  },
  FedEx: {
    name: 'FedEx',
    trackingUrl: (tn) =>
      `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`,
    homeUrl: 'https://www.fedex.com',
    favicon: 'https://www.fedex.com/favicon.ico',
    validate: (tn) => /^\d{12,22}$/.test(tn) || /^DT\d{12}$/i.test(tn),
  },
};

export function detectCarrier(tn: string): Carrier | null {
  const cleaned = tn.trim().toUpperCase();
  if (CARRIER_CONFIG.USPS.validate(cleaned)) return 'USPS';
  if (CARRIER_CONFIG.FedEx.validate(cleaned)) return 'FedEx';
  return null;
}

export function resolveCarrier(
  carrierHint: string | null,
  tn: string
): Carrier | null {
  const hint = carrierHint?.trim().toLowerCase();
  if (hint === 'usps' || hint === 'u') return 'USPS';
  if (hint === 'fedex' || hint === 'f' || hint === 'fx') return 'FedEx';
  return detectCarrier(tn);
}
