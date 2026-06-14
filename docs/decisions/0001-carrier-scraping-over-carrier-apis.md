# 0001 — Use carrier-page scraping before carrier APIs

**Status:** Accepted  
**Date:** 2026-06-13

## Context

Package Tracker tracks USPS, FedEx, and UPS packages from a web UI and Telegram bot. The app currently advertises no required carrier API keys, auto-detects common carrier tracking-number formats, performs scheduled checks, and sends Telegram notifications only when package status changes.

Carrier APIs would provide a cleaner integration surface, but they add account setup, approval flows, key management, rate limits, carrier-specific commercial requirements, and extra deployment configuration. For a small personal/internal tracker, that overhead is higher than the current product needs.

The repo already has a scraping-oriented architecture using Puppeteer and a stealth plugin to render carrier tracking pages, extract status/location/timeline data, and avoid duplicate notifications. Recent work has also improved carrier-specific behavior: UPS support/auth/deployment packaging, FedEx scraping, sequential carrier checks to reduce peak RAM, and USPS shipping-partner status parsing.

## Decision

Continue using carrier tracking-page scraping as the primary data source for USPS, FedEx, and UPS.

Keep the abstraction carrier-specific, with one service per carrier responsible for:

- opening the official carrier tracking page;
- extracting latest status, description, location, and timeline events;
- normalizing output into the shared package/status model;
- handling carrier-specific browser/runtime requirements;
- failing safely without breaking checks for other carriers.

Do not introduce carrier API integrations until scraping instability, scale, or product requirements make the API overhead worthwhile.

## Consequences

### Positive

- No carrier API keys or approval workflow required.
- Faster setup for local use and private deployment.
- Same user flow across USPS, FedEx, and UPS.
- Easier to support user-provided tracking numbers without account-level carrier setup.
- Keeps the product lightweight and aligned with the current personal/package-monitoring use case.

### Negative

- Scrapers can break when carrier websites change markup, wording, bot detection, or page flow.
- Browser automation adds memory/runtime cost versus direct HTTP APIs.
- Carrier-specific anti-bot behavior requires operational knobs such as headless/headful browser modes, Chrome paths, user-data directories, and cooldowns.
- Parsing logic can become brittle as more tracking edge cases are discovered.

## Guardrails

- Keep scraper output normalized before it touches notification/UI logic.
- Prefer small carrier-specific fixes over spreading carrier wording/parsing assumptions through the app.
- Add status samples or fixtures when fixing parser bugs so regressions are easier to catch.
- Run carrier checks sequentially unless there is a measured need for concurrency.
- Keep browser/runtime configuration explicit in environment variables.

## Revisit when

- A carrier scraper breaks frequently enough to dominate maintenance time.
- The app moves from personal/internal use to multi-user production use.
- API access becomes easy enough that setup friction is lower than scraper maintenance.
- Rate limits, bot detection, memory usage, or deployment constraints make browser scraping unreliable.
