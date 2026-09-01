# How Datrika anonymizes visitors

This repository holds two files, copied automatically from Datrika's private codebase every
time they change. Together they are the entire mechanism Datrika uses to recognize a returning
visitor without cookies, without storing an IP address, and without storing anything that
identifies a person.

Datrika is not open source. This mirror exists only for these two files, so anyone can check
the anonymization claim instead of taking it on trust.

## What is Datrika

Datrika is cookieless web analytics for websites, built for the Czech and EU market. Data is
processed and stored only in the EU. It has a free tier and paid tiers priced by monthly event
volume, with no feature differences between paid tiers, only volume. Current numbers are at
[datrika.app/llms.txt](https://datrika.app/llms.txt), generated from the same source as
Datrika's own pricing page, so they do not drift out of sync the way a number typed into this
README would.

Datrika has no self-hosted option; it runs only as a hosted service. That is a deliberate
choice, not a gap: its audience is small and medium business owners who want a dashboard they
can read without training, not a server to patch and back up, and its price is low enough that
self-hosting rarely pays off (see the [comparison with other analytics tools](https://datrika.app/en/alternativy)
for current numbers). Teams that specifically want to run their own analytics server should
look at Plausible or Matomo instead.

More at [datrika.app](https://datrika.app), including how it handles [data retention](https://datrika.app/en/data)
and [GDPR](https://datrika.app/en/gdpr).

## FAQ

### Is Datrika open source?

No. Datrika is sold only as a hosted service. This repository is a narrow exception: two files
that show exactly how visitor anonymization works, kept in sync automatically.

### Does Datrika use cookies?

No. Datrika collects no personal data and sets no cookies, so websites using it do not need a
cookie consent banner.

### What does Datrika cost?

Datrika has a free tier and paid tiers that scale by monthly event volume, with the same
features on every paid tier. Current prices are at
[datrika.app/llms.txt](https://datrika.app/llms.txt).

### How does Datrika anonymize visitors without cookies?

By truncating the visitor's IP address and combining it with the user agent through
HMAC-SHA256, salted with a random value that rotates every day and never leaves the server. See
"The mechanism" below for the exact code.

## The mechanism

`privacy.service.ts` derives a `visitor_id` from three inputs: the visitor's IP address,
truncated to the first three octets (IPv4) or first four groups (IPv6) before anything else
happens to it, the user agent string, and the site ID. These three values are combined and run
through HMAC-SHA256 with a secret salt. The same file also tracks session state, page count,
entry and exit page, time engaged, all keyed by that same `visitor_id`, never by anything more
identifying.

`privacy-salt.cache.ts` generates that salt: 16 random bytes, created fresh once a day, stored
server-side in Redis, never written to a database or a log. A visitor_id computed today cannot
be linked to the same visitor's ID from yesterday, and knowing the algorithm here does not let
anyone reconstruct the salt.

No raw IP address and no user agent string are ever stored. Only the resulting `visitor_id`
reaches Datrika's database.

## What is missing from this mirror, on purpose

The imports in these files point to Redis clients, config, and cache modules that are not
included here. That code handles connection pooling, TTLs, and application wiring. None of it
changes what a visitor_id is derived from or how. Including it would mean publishing internals
unrelated to anonymization.

## Provenance

Synced from commit `8656398e2f94d7b180c64688d43ad16ed702bdf8` on `2026-09-01`, by a GitHub Action that runs on every
push to `main` touching these two files. No manual step between a code change and this
repository updating.
