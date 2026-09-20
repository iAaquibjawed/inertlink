# Chrome Web Store submission

Everything the dashboard asks for. The manifest itself is already compliant; what follows is the
material you have to type or upload, which is where submissions usually stall.

---

## 1. Single purpose

> InertLink shows a safety verdict for a link before you click it.

Keep it to one sentence. The single-purpose policy is the most common rejection reason, and this
extension genuinely has one purpose — say it narrowly rather than listing features.

## 2. Permission justifications

Paste these into the corresponding fields. Each states what breaks without it.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's own settings (sensitivity, allow/blocklists, optional API key) and a local cache of verdicts keyed by hostname. Without it no preference survives a restart and every hostname would be re-checked. |
| `scripting` | Registers the hover content script for the specific origins the user has granted, and injects it into the current tab when the user clicks the toolbar icon. The extension declares no static content script, so without this it runs nowhere. |
| `activeTab` | Lets the extension work on the current tab for the current visit when the user clicks the toolbar icon, with no host permission prompt. This is the default way the extension is used. |
| `alarms` | Schedules the optional weekly blocklist refresh. An MV3 worker sleeps, so a timer cannot survive. The alarm does nothing unless the user has enabled online checks and supplied a feed URL. |
| `http://*/*`, `https://*/*` (optional) | Only requested if the user chooses "run on every site automatically" so they are not clicking the toolbar icon on each new site. Never requested at install. Users may instead grant a single site, or grant nothing and use `activeTab`. |

## 3. Data usage disclosure

Tick these in the dashboard:

- **Does this item collect or transmit user data?** — Yes (conditionally; see below).
- **Web history** — only if the user enables online reputation checks. Then the **hostname** of a
  link whose local verdict is inconclusive is sent to the provider the user selected, using the
  user's own API key. Never the path or query string. Results are cached so a host is not sent
  twice. Off by default.
- **Personally identifiable information** — No.
- **Authentication information** — No.
- **Financial / health / location / personal communications** — No.

Certify all three:
- Not sold to third parties
- Not used for anything unrelated to the single purpose
- Not used to determine creditworthiness or for lending

## 4. Privacy policy

A privacy policy URL is **required** because the data disclosure is not "no data". Publish
`docs/PRIVACY.md` at a public URL — for example alongside the landing page — and paste that link.

## 5. Listing assets

| Asset | Requirement | Status |
|---|---|---|
| Store icon | 128×128 PNG | `assets/icons/icon-128.png` |
| Screenshots | 1280×800 or 640×400, at least one, up to five | **you need to capture these** |
| Small promo tile | 440×280 | optional |
| Marquee | 1400×560 | optional |

Screenshots to take, in this order — they tell the product's story:
1. A danger badge on a real-looking link (the userinfo trick reads best).
2. A caution badge, to show it is not binary.
3. The popup, showing per-site control.
4. The options page, showing the privacy toggle in its default **off** state.

## 6. Pre-upload checklist

```bash
npm test      # 71 unit tests
npm run e2e   # 30 end-to-end checks in a real Chrome
npm run build # writes dist/
```

Then zip the **contents** of `dist/` — not the folder itself:

```bash
cd dist && zip -r ../inertlink-0.1.0.zip . -x '.*' && cd ..
```

Verify the zip has `manifest.json` at its root, not `dist/manifest.json`.

## 7. Known review considerations

- **No remote code.** Everything is bundled; `build.mjs` fails if a CDN URL appears in `dist/`.
  Reviewers check this, and it is the other common rejection reason.
- **Code is not obfuscated.** The content script ships unminified on purpose so a reviewer can
  read it against the public source.
- **Broad host permissions are optional, not required.** Expect a reviewer to ask why
  `https://*/*` is listed at all; the answer is in the table above — it is opt-in and the
  extension is fully usable without it.
