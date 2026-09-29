import type { SVGProps } from "react";
import {
  CARRIERS,
  getCarrierTrackingUrl,
  type Carrier,
} from "@/lib/services/carriers";

interface CarrierTheme {
  label: string;
  formatHint: string;
  badgeClass: string;
  cardClass: string;
  detectedClass: string;
  historyBorderClass: string;
  historyCardClass: string;
  statusTextClass: string;
  timelineDotClass: string;
}

const UNKNOWN_THEME: CarrierTheme = {
  label: "Carrier",
  formatHint: "",
  badgeClass: "carrier-badge-default",
  cardClass: "carrier-card-default",
  detectedClass: "carrier-detected-default",
  historyBorderClass: "carrier-history-border-default",
  historyCardClass: "carrier-history-card-default",
  statusTextClass: "text-blue-400",
  timelineDotClass: "carrier-timeline-dot-default",
};

export const CARRIER_THEMES: Record<Carrier, CarrierTheme> = {
  USPS: {
    label: "USPS",
    formatHint: "20-22 digits",
    badgeClass: "carrier-badge-usps",
    cardClass: "carrier-card-usps",
    detectedClass: "carrier-detected-usps",
    historyBorderClass: "carrier-history-border-usps",
    historyCardClass: "carrier-history-card-usps",
    statusTextClass: "text-blue-400",
    timelineDotClass: "carrier-timeline-dot-usps",
  },
  FedEx: {
    label: "FedEx",
    formatHint: "12+ digits",
    badgeClass: "carrier-badge-fedex",
    cardClass: "carrier-card-fedex",
    detectedClass: "carrier-detected-fedex",
    historyBorderClass: "carrier-history-border-fedex",
    historyCardClass: "carrier-history-card-fedex",
    statusTextClass: "text-purple-300",
    timelineDotClass: "carrier-timeline-dot-fedex",
  },
  UPS: {
    label: "UPS",
    formatHint: "1Z + 16 letters/digits",
    badgeClass: "carrier-badge-ups",
    cardClass: "carrier-card-ups",
    detectedClass: "carrier-detected-ups",
    historyBorderClass: "carrier-history-border-ups",
    historyCardClass: "carrier-history-card-ups",
    statusTextClass: "text-amber-300",
    timelineDotClass: "carrier-timeline-dot-ups",
  },
  UniUni: {
    label: "UniUni",
    formatHint: "UUS + letters/digits",
    badgeClass: "carrier-badge-uniuni",
    cardClass: "carrier-card-uniuni",
    detectedClass: "carrier-detected-uniuni",
    historyBorderClass: "carrier-history-border-uniuni",
    historyCardClass: "carrier-history-card-uniuni",
    statusTextClass: "text-orange-300",
    timelineDotClass: "carrier-timeline-dot-uniuni",
  },
};

function toCarrier(value: string | null | undefined): Carrier | null {
  if (!value) return null;
  return CARRIERS.includes(value as Carrier) ? (value as Carrier) : null;
}

function carrierLabel(carrier: string | null | undefined): string {
  const knownCarrier = toCarrier(carrier);
  return knownCarrier
    ? CARRIER_THEMES[knownCarrier].label
    : carrier || UNKNOWN_THEME.label;
}

function LogoSvg({
  carrier,
  ...props
}: SVGProps<SVGSVGElement> & { carrier: string | null | undefined }) {
  const knownCarrier = toCarrier(carrier);

  if (knownCarrier === "UniUni") {
    return (
      <svg viewBox="0 0 86 48" role="img" aria-label="UniUni logo" {...props}>
        <rect width="86" height="48" rx="9" fill="#ffffff" />
        <path d="M9 13 20 7l11 6v14L20 33 9 27V13Z" fill="#242424" />
        <path d="m15 16 5-3 5 3-5 3-5-3Zm0 2.5 4 2.3v6l-4-2.3v-6Zm10 0v6l-4 2.3v-6l4-2.3Z" fill="#ff7a16" />
        <text
          x="35"
          y="29"
          fill="#242424"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="15"
          fontWeight="700"
        >
          uni
        </text>
        <text
          x="58"
          y="29"
          fill="#ff7a16"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="15"
          fontWeight="700"
        >
          uni
        </text>
      </svg>
    );
  }

  if (knownCarrier === "UPS") {
    return (
      <svg viewBox="0 0 64 64" role="img" aria-label="UPS logo" {...props}>
        <path
          d="M32 4 53 12.2v16.2c0 14.3-8.2 25.6-21 31.1-12.8-5.5-21-16.8-21-31.1V12.2L32 4Z"
          fill="#351c0f"
          stroke="#f6be00"
          strokeWidth="3"
        />
        <path
          d="M17 16.5 32 10.8l15 5.7v11.7c0 10.7-5.3 19.3-15 24.1-9.7-4.8-15-13.4-15-24.1V16.5Z"
          fill="#4b2613"
        />
        <path
          d="M18 17.2 32 11.8l14 5.4v6.3c-8.2 2-17.9 1.5-28-1.4v-4.9Z"
          fill="#f6be00"
          opacity="0.18"
        />
        <text
          x="32"
          y="38"
          textAnchor="middle"
          fill="#f6be00"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="18"
          fontWeight="800"
        >
          UPS
        </text>
      </svg>
    );
  }

  if (knownCarrier === "FedEx") {
    return (
      <svg viewBox="0 0 86 48" role="img" aria-label="FedEx logo" {...props}>
        <rect width="86" height="48" rx="9" fill="#f8fafc" />
        <text
          x="8"
          y="31"
          fill="#4d148c"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="22"
          fontWeight="800"
        >
          Fed
        </text>
        <text
          x="49"
          y="31"
          fill="#ff6600"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="22"
          fontWeight="800"
        >
          Ex
        </text>
      </svg>
    );
  }

  if (knownCarrier === "USPS") {
    return (
      <svg viewBox="0 0 64 64" role="img" aria-label="USPS logo" {...props}>
        <rect width="64" height="64" rx="12" fill="#1f5aa6" />
        <path d="M13 25.5h36L37.5 34H13v-8.5Z" fill="#ffffff" />
        <path d="M28 18h26L41.5 27.5H28V18Z" fill="#ffffff" opacity="0.92" />
        <path d="M13 40h38v6H13v-6Z" fill="#d71920" />
        <text
          x="32"
          y="57"
          textAnchor="middle"
          fill="#ffffff"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="8"
          fontWeight="800"
        >
          USPS
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="Carrier logo" {...props}>
      <rect width="64" height="64" rx="12" fill="#374151" />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fill="#d1d5db"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="12"
        fontWeight="800"
      >
        {carrierLabel(carrier).slice(0, 4).toUpperCase()}
      </text>
    </svg>
  );
}

export function getCarrierTheme(
  carrier: string | null | undefined,
): CarrierTheme {
  const knownCarrier = toCarrier(carrier);
  return knownCarrier ? CARRIER_THEMES[knownCarrier] : UNKNOWN_THEME;
}

export function getCarrierHref(
  carrier: string,
  trackingNumber: string,
): string {
  return getCarrierTrackingUrl(carrier, trackingNumber);
}

export function CarrierLogo({
  carrier,
  className = "",
}: {
  carrier: string | null | undefined;
  className?: string;
}) {
  return (
    <span className={`carrier-logo ${className}`} aria-hidden="true">
      <LogoSvg carrier={carrier} />
    </span>
  );
}

export function CarrierBadge({
  carrier,
  className = "",
}: {
  carrier: string | null | undefined;
  className?: string;
}) {
  const theme = getCarrierTheme(carrier);

  return (
    <span className={`carrier-badge ${theme.badgeClass} ${className}`}>
      <CarrierLogo carrier={carrier} className="carrier-badge-logo" />
      <span>{theme.label}</span>
    </span>
  );
}
