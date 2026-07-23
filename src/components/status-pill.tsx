type StatusTone = "delivered" | "attention" | "transit" | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  delivered: "status-pill-delivered",
  attention: "status-pill-attention",
  transit: "status-pill-transit",
  neutral: "status-pill-neutral",
};

export function getStatusTone(status: string): StatusTone {
  const normalized = status.toLowerCase();

  if (normalized.includes("delivered")) return "delivered";
  if (
    /(exception|delay|fail|return|held|refus|damage|miss|unable)/.test(
      normalized,
    )
  ) {
    return "attention";
  }
  if (
    /(label|created|pre-?ship|pending|info(rmation)? received|awaiting)/.test(
      normalized,
    )
  ) {
    return "neutral";
  }

  return "transit";
}

export function StatusPill({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={`status-pill ${TONE_CLASS[getStatusTone(status)]} ${className}`}
    >
      <span aria-hidden="true" className="status-pill-dot" />
      {status}
    </span>
  );
}
