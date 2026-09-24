# KK8 Review BD — Review & Trust Hub — `kk8.news`

Editorial review property in the KK8 Bangladesh two-site brand SEO campaign.
Static HTML, Bengali content, deployed on GitHub Pages behind Cloudflare.

**Search intent this property owns:** investigational (kk8 review, is kk8 legit, kk8 safe, kk8 bd, kk8 withdrawal, kk8 bonus, kk8 customer service).
It must NOT compete with `kk8.site` on the same intent — that is what keeps both
properties on page one instead of one filtering the other.

---

## How to edit this site

### The short version

Every page in the repo root (`index.html`, `kk8-review.html`, …) is plain HTML.
**You can open any of them in a text editor, change the words, save, and the live
site updates when you push.** Nothing has to be compiled to change text.

### The proper version

Root HTML files are *generated*. If you edit them directly, your change is
overwritten the next time someone runs a build. To make a change that lasts, edit
the source instead:

| To change… | Edit this |
|---|---|
| Page text | `pages/<slug>.html` |
| Header, footer, shared blocks | `partials/` |
| Titles, meta descriptions, H1s | `pages.json` |
| Domain, CTA link, licence, payment methods, providers | `site.config.json` |
| Colours, fonts, spacing | `tailwind.config.js` |
| Component styling | `src/input.css` |

Then rebuild:

```bash
npm run build
```

### Changing the money-site link everywhere

The register/login/deposit buttons all point at one value. Open
`site.config.json`, change `moneySite`, run `npm run build`. Every page updates.
**This is the one edit to make when KK8 finalises the Bangladesh site.**

---

## Build requirements

Node 18+ and npm. First time only:

```bash
npm install
```

Then `npm run build` (HTML + CSS), or `npm run watch` while styling.

The site is static: once built, it needs no Node, no server and no database.
GitHub Pages serves the repo root directly.

---

## The build will refuse to publish broken SEO

`npm run build` runs nine validation gates and **fails with a non-zero exit** if
any page breaks one. This is deliberate — it is cheaper to fail a build than to
publish a page that quietly loses its ranking.

1. Exactly one `<h1>`, containing `KK8`
2. The Latin primary keyword appears in the page text (BD players type Latin)
3. Title + meta description present, unique site-wide, carrying a geo token
4. Canonical present and on the configured domain
5. All JSON-LD parses; every declared schema type is emitted
6. Every image has non-empty Bengali alt text
7. No internal link points at a page that isn't in `pages.json`
8. `lang="bn"`; hreflang self-referencing only, never cross-domain
9. No body paragraph is duplicated on the sister property
10. No MYR/RM figures, no Malaysian payment rails, no Bangladesh legality claim

If a gate fails it names the page and the rule. Fix the source, rebuild.

---

## Rules that are not style preferences

- **Never state or imply that gambling is legal in Bangladesh.** Gate 9 blocks the
  obvious phrasings, but it cannot catch every wording. Don't try.
- **Never invent a number.** Bonus amounts, minimum deposits, processing times,
  licence details, player counts. If it isn't published on KK8's official
  platform, it does not go on the page. Gate 9 catches currency leaks, not
  invented BDT figures — that one is on the writer.
- **Never copy text from the clone sites** (`kk8.run`, `kk8bd.net`) or from the
  sister property.
- **Keep the 18+ signal and the Kaan Pete Roi helpline in the footer.**
- **Re-verify facts before each publish.** Update `lastVerified` in
  `site.config.json` when you do; it renders as the "সর্বশেষ যাচাই" stamp.

---

## Deploying

```bash
npm run build
git add -A && git commit -m "content: <what changed>"
git push
```

GitHub Pages serves `main`. `CNAME` holds `kk8.news` — do not delete it, or the
custom domain unbinds.

---

## Rollback

Every build is a commit, so every version is recoverable:

```bash
git log --oneline          # find the good commit
git revert <commit>        # undo one commit, keeping history
git push
```

To preview an old version without publishing it:
`git checkout <commit>`, look, then `git checkout main`.

---

## File map

```
build.mjs            build script — reads config + pages, writes HTML, runs the gates
site.config.json     every value that changes: domain, CTA target, licence, payments
pages.json           the 16 pages: slugs, titles, meta, keywords, schema, FAQ data
pages/               page body content (edit here, not the root HTML)
partials/            header, footer, shared components
src/input.css        Tailwind source + component layer
tailwind.config.js   brand tokens — #0047FF blue, #001957 navy, radii, spacing
assets/css/          compiled CSS (generated)
assets/js/site.js    mobile nav + FAQ accordion, vanilla JS
assets/img/          self-hosted brand assets (never hotlink the operator's)
sitemap.xml          generated from pages.json
robots.txt           generated
CNAME                custom domain for GitHub Pages
```
