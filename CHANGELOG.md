# Changelog

All notable changes to 8star-prep are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-13

First public release. / Eerste publieke release.

### Added

- **Dashboard**: days of food (kcal and macros) and drinking water for the target duration, overall coverage, shortages and items needing attention.
- **Inventory**: products with batches, locations, partial packages, drained weight, dry vs prepared, ready-to-eat vs needs cooking. CSV import (template, preview, validation) and export.
- **Nutrition catalogue**: 53 bundled generic entries from USDA SR28, always marked as estimates; label values override the catalogue. Editable, CSV import/export.
- **Ration plan**: deterministic day-by-day plan from stock you actually have, per household and per member, with lockable and editable meals, exact deficits, stock reservation and one-time "Mark consumed". Printable plan and shortage list.
- **Expiry**: overview by status and a daily email digest over SMTP with per-recipient language, retries and a follow-up when items expire.
- **Settings**: household members and targets, duration, water target, timezone, SMTP, users, demo data.
- Dutch and English interface and emails, chosen per user.
- Self-hosting with Docker Compose (works with Dockhand), automatic pre-migration backups and an online backup command.
- Security: scrypt passwords, hashed sessions, CSRF check, login rate limiting, strict CSP, encrypted SMTP password, non-root read-only container.
- Screenshots in the README (desktop and mobile, NL and EN).

[1.0.0]: https://github.com/TimoM84/8star-prep/releases/tag/v1.0.0
