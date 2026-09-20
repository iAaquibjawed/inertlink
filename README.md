<div align="center">

<img src="assets/brand/inertlink-logo-full.png" alt="InertLink" width="200">

### See where a link really goes — before you click it

Hover any link and a badge names the site that **actually** owns it.<br>
Fourteen checks, on your device, with **zero network by default**.

[![License: MIT](https://img.shields.io/badge/License-MIT-5BD6A4.svg?style=flat-square)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-F2B441.svg?style=flat-square)](src/manifest.json)
[![Tests](https://img.shields.io/badge/tests-71%20unit%20%2B%2030%20e2e-5BD6A4.svg?style=flat-square)](#testing)
[![Content script deps](https://img.shields.io/badge/content%20script-0%20dependencies-93A0B4.svg?style=flat-square)](docs/DECISIONS.md)

[**Install**](#install) · [**How it works**](#how-it-works) · [**What it catches**](#what-it-catches) · [**Privacy**](#privacy) · [**Contributing**](#contributing)

</div>

---

```
https://example.com.secure-billing.invalid/pay
        └──── you read this ────┘└─ your browser obeys this ─┘
```

That gap is how phishing works, and closing it is the whole product. InertLink shows a verdict next
to your cursor in the 250 ms between resting on a link and deciding to click — naming the
registrable domain, the one part of a URL that says who you are really about to visit.

It is **local-first**. A fresh install makes no network requests at all: not on install, not on
hover, not on a schedule. An optional second opinion exists, is off by default, and sends only a
hostname when you switch it on.

---

## Install

Not on the Chrome Web Store yet. Load it unpacked — about a minute.

```bash
git clone https://github.com/iAaquibjawed/inertlink.git
cd inertlink
npm install
npm run build
```

Then: **`chrome://extensions`** → enable **Developer mode** → **Load unpacked** → select **`dist/`**.

> [!IMPORTANT]
> Select `dist/`, **not** the repo folder. There is deliberately no `manifest.json` at the repo root
> so that picking it fails loudly instead of installing an extension that silently does nothing
> ([ADR-0009](docs/DECISIONS.md)).

### First run

Click the toolbar icon on any normal page — that's it. Badges work immediately, with no permission
prompt, because clicking the icon is an `activeTab` grant.

There are three levels of access, and you choose:

| Level | How | Lasts |
|---|---|---|
| **Click the icon** *(default)* | Toolbar icon | That tab, that visit |
| **This site** | Popup → *Always run on \<host\>* | That site, until removed |
| **Every site** | Popup → *Or run on every site* | Everywhere, until turned off |

Nothing is requested at install ([ADR-0010](docs/DECISIONS.md), [ADR-0012](docs/DECISIONS.md)).

---

## How it works

```
hover → 250 ms dwell → parse the href as a string (never fetched)
      → 14 independent checks, each returning { id, hit, weight, reason }
      → sum the weights → threshold by sensitivity → safe / caution / danger
      → borderline AND online checks on AND not allowlisted?
           → service worker → cache? → provider (hostname only) → worst-wins merge
```

Hovering **never contacts the link**. Resolving a shortener to see where it lands would be a request
to the attacker's server, from your IP, triggered by a mouse movement you never meant as a click.

Thresholds and per-check weights live in exactly one file,
[`src/engine/scoring.js`](src/engine/scoring.js). [`tests/fixtures/urls.json`](tests/fixtures/urls.json)
is the spec they are calibrated against — **the fixtures are written first, and the numbers move to
satisfy them, never the reverse.**

| Score (balanced) | Verdict |
|---|---|
| `< 20` | Safe |
| `20 – 39` | Caution |
| `≥ 40` | Danger |

Two signals sit outside the sum: a blocklist hit forces **danger**, an allowlist hit forces **safe**,
and the blocklist wins a tie. Over-warning costs a click; under-warning costs an account.

---

## What it catches

Each check is one file in [`src/engine/checks/`](src/engine/checks/), registered in one array. Adding
a signal is one file, one line, and one fixture — never a branch in a growing conditional.

| Check | Catches |
|---|---|
| `typosquat` | A domain one or two edits from a real brand. Folds lookalikes first: `paypa1` → `paypal`, `exarnple` → `example` |
| `userinfo-trick` | `https://example.com@evil.invalid` — everything before the `@` is discarded by the browser |
| `deceptive-subdomain` | `example.com.secure-billing.invalid` — the brand is only a prefix |
| `text-href-mismatch` | Link text names one site, the `href` points at another |
| `punycode-idn` | Letters from another alphabet chosen because they look like English ones |
| `ip-host` | A bare IP instead of a named site — bypasses every domain reputation system |
| `encoded-obfuscation` | Heavy encoding, a nested second address, a machine-generated hostname |
| `url-shortener` | Destination hidden. We will **not** resolve it |
| `suspicious-tld` | Graded, not binary. `.zip` reads as a filename; cheap TLDs only add weight |
| `excessive-subdomains` | Padding so the words you read have nothing to do with the owner |
| `nonstandard-port` | A sign-in page on an odd port |
| `non-https` | Unencrypted, or a scheme that runs code instead of opening a page |
| `local-blocklist` | A known-phishing host. Decisive, and it outranks the allowlist |
| `allowlist` | Known-safe or user-trusted. Short-circuits, and is never sent anywhere |

**It also tells you when a link goes nowhere.** `href="#"` and `javascript:void(0)` are reported as
an **InertLink** — the quiet state the product is named after. They are not dangerous, and calling
them dangerous put a red badge on fourteen controls of one legitimate Amazon page
([ADR-0016](docs/DECISIONS.md)).

---

## Privacy

- **Zero network by default.** Every check runs against data bundled in the extension.
- **Hovering never touches the link.** The URL is read as text, never followed.
- **Hostname only, if you opt in.** Never the path or query string — those carry session tokens,
  reset links and search terms. Cached, so a host is never sent twice.
- **Per-tab counts live in that tab's memory** and die with it. Nothing about what you hovered is
  written to disk.
- **No remote code.** `npm run build` fails if a CDN URL appears anywhere in `dist/`.

Full policy: [`docs/PRIVACY.md`](docs/PRIVACY.md) · Security review: [`docs/SECURITY.md`](docs/SECURITY.md)

### Permissions

| Permission | Why |
|---|---|
| `storage` | Settings (`sync`) and the verdict cache (`local`) |
| `scripting` | Register the content script per granted origin; inject into a tab you just granted |
| `activeTab` | The popup needs the current tab's URL. Narrower than `tabs`, which exposes every tab permanently |
| `alarms` | Weekly blocklist refresh. Inert unless you enable online checks *and* set a feed URL |
| `optional_host_permissions` | Page access, granted by you, one site at a time. Not requested at install |

---

## Development

```bash
npm run build        # → dist/   (required before loading)
npm run watch        # rebuild on save
npm test             # 71 unit tests — engine + settings
npm run e2e          # 30 checks in a real Chrome
npm run smoke        # serve the manual test page on :8787
npm run site         # build the landing page → site/dist/
npm run site:dev     # watch + serve the site on :5173
```

### Testing

`npm test` proves the engine is correct. It cannot prove the extension *runs* — and **every real
failure this project has had lived in that gap while the unit tests stayed green**: a manifest whose
paths resolved to nothing, a permission prompt that never resolved, a badge hidden behind a site's
navbar.

`npm run e2e` closes it. It installs `dist/` into a throwaway Chrome profile over the DevTools
protocol and asserts the whole chain — worker starts, content script registers for the granted
origin *only*, injects, seven fixture links hovered for real with verdicts read back from the content
script's own tally, **zero off-origin requests while hovering**, and the activeTab path. No
dependencies. `HEADED=1 npm run e2e` to watch it.

### Manual testing

```bash
npm run smoke   # → http://localhost:8787/phishing-sandbox.html
```

Nothing on that page resolves — every hostname is an RFC 2606 reserved name or an RFC 5737
documentation IP, the same rule the fixtures follow. Serve it over http, not `file://`: a file URL
has an opaque origin that cannot be written as a match pattern.

### Layout

```
src/engine/     pure detection logic — no DOM, no chrome.*, no fetch. The only tested code
src/content/    hover listener + shadow-DOM badge. Ships zero dependencies
src/worker/     service worker: providers, verdict cache, all network, the API key
src/shared/     message contract, settings, origin rules, design tokens
src/popup/      toolbar popup (React + Framer Motion)
src/options/    settings page (React + Framer Motion)
site/           the landing page (GSAP, self-hosted fonts)
tests/          vitest + golden URL fixtures + CDP e2e harness + a manual smoke page
```

The engine is **pure** — no DOM, no `chrome.*`, no `fetch` — which is why the landing page imports it
directly and computes real verdicts in the browser. The demo cannot drift from the product, because
it *is* the product.

---

## Docs

| File | What's in it |
|------|--------------|
| [`PLAN.md`](PLAN.md) | Product spec, detection design, phased roadmap |
| [`CLAUDE.md`](CLAUDE.md) | Operating manual and golden rules for contributors |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 16 ADRs — what was chosen over what, and why |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security review, findings, accepted residual risk |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Privacy policy |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Trust boundaries, hover flow, failure behaviour |
| [`docs/STORE_SUBMISSION.md`](docs/STORE_SUBMISSION.md) | Chrome Web Store checklist |
| [`design-system/inertlink/MASTER.md`](design-system/inertlink/MASTER.md) | Colour, type, motion, component specs |

The ADR log is worth reading before changing anything — several entries exist because a reasonable
change caused a real bug.

---

## Contributing

Contributions welcome. Before opening a PR:

1. **Read [`CLAUDE.md`](CLAUDE.md).** It pins the golden rules — no remote code, privacy first, never
   auto-fetch a hovered link, the engine stays pure.
2. **Write the fixture first.** A new check means a case in
   [`tests/fixtures/urls.json`](tests/fixtures/urls.json), then the code to satisfy it.
3. **`npm test` and `npm run e2e` must both be green.**
4. **Record non-obvious choices** as an ADR in [`docs/DECISIONS.md`](docs/DECISIONS.md).

Adding a detection check is deliberately small: one file in `src/engine/checks/`, one line in
`registry.js`, one weight in `scoring.js`, one fixture.

**Found a false positive?** That is the most valuable bug report this project can receive — a
security tool that cries wolf gets turned off. Open an issue with the URL and what you expected.

### Reporting a vulnerability

Please report security issues privately by email rather than in a public issue.
[`docs/SECURITY.md`](docs/SECURITY.md) has the current review and the residual risks already
accepted.

---

## Deploying the landing page

[`render.yaml`](render.yaml) is a Render blueprint: **New → Blueprint** → point it at this repo. It
builds with `npm ci && npm run site` and publishes `site/dist/`.

The blueprint is in the repo on purpose. It holds no secrets and cannot — what it holds is the build
command and the response headers, which are the part of a deploy worth reviewing in public. The CSP
is strict (`default-src 'none'`) and only achievable because the page is genuinely self-contained:
no CDN font, no CDN script, no analytics.

> [!WARNING]
> Never put cloud credentials in this repo or in CI secrets. Nothing here needs them. If you later
> automate a deploy to AWS, use OIDC role assumption rather than a long-lived access key.

---

## License

[MIT](LICENSE) — © 2026 Mohammad Aaquib Jawed.

Open source on purpose: *"zero network by default"* is a claim, and the only way anyone can check it
is to read the code. A Chrome extension ships its source to every user anyway — a `.crx` is a zip —
so closing it would hide the code from honest people only.

<div align="center">
<br>

**[aaquibjawed.com](https://aaquibjawed.com)** · [GitHub](https://github.com/iAaquibjawed) · [LinkedIn](https://www.linkedin.com/in/md-aaquib-jawed-0b15a3205)

<sub>A link points somewhere, or it doesn't. Either way you should be told.</sub>

</div>
