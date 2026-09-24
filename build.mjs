#!/usr/bin/env node
/**
 * KK8 Bangladesh — static build.
 *
 * Reads site.config.json + pages.json, resolves partials and tokens, emits flat
 * HTML at the repo root (GitHub Pages serves `main` directly), generates
 * sitemap.xml + robots.txt from the manifest, then runs validation gates.
 *
 * No framework, no runtime. Node stdlib only. See docs spec §9.
 * Non-zero exit on any gate failure.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const { pages } = JSON.parse(readFileSync(join(ROOT, 'pages.json'), 'utf8'));

const GEO_TOKENS = ['Bangladesh', 'বাংলাদেশ', 'বাংলাদেশে', 'BD'];
const errors = [];
const warns = [];
const fail = (slug, gate, msg) => errors.push(`[${slug}] gate ${gate}: ${msg}`);

/* ---------------------------------------------------------------- helpers */

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const partial = (name) => read(`partials/${name}.html`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Resolve a dotted path against the context, e.g. "licence.number". */
const lookup = (ctx, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);

/** Expand `<!-- include: name -->` recursively (depth-capped). */
function includes(html, depth = 0) {
  if (depth > 8) throw new Error('include depth exceeded — circular partial?');
  return html.replace(/<!--\s*include:\s*([\w-]+)\s*-->/g, (_, name) =>
    includes(partial(name), depth + 1));
}

/** Substitute `{{token}}` from the context. Unknown tokens are a hard error. */
function tokens(html, ctx, where) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = lookup(ctx, path);
    if (v === undefined || v === null) {
      errors.push(`[${where}] unresolved token {{${path}}}`);
      return '';
    }
    return String(v);
  });
}

const moneyUrl = () => cfg.moneySite + (cfg.moneySiteParams || '');

/* ------------------------------------------------------- computed fragments */

function providerGrid() {
  return cfg.providers.map((p) =>
    `<li class="flex items-center justify-center rounded-base border border-brand-hair bg-white px-4 py-3 text-sm font-semibold text-brand-navy">${esc(p.name)}</li>`
  ).join('\n');
}

function paymentList() {
  return cfg.paymentRails.map((r) =>
    `<li class="flex items-start gap-3 rounded-base border border-brand-hair bg-brand-tint p-4">
      <span class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-brand-blue" aria-hidden="true"></span>
      <span><strong class="font-bold text-brand-navy">${esc(r.nameBn)}</strong>
      <span class="text-brand-slate"> (${esc(r.name)}) — ${esc(r.type)}</span></span>
    </li>`
  ).join('\n');
}

function categoryGrid() {
  return cfg.productCategories.map((c) =>
    `<li><a href="/games-software.html"
      class="block rounded-base border border-brand-hair bg-white p-5 transition hover:border-brand-blue hover:shadow-sm">
      <span class="block text-lg font-bold text-brand-navy">${esc(c.nameBn)}</span>
      <span class="mt-1 block text-sm text-brand-slate">${esc(c.name)}</span></a></li>`
  ).join('\n');
}

function trustMarks() {
  return cfg.trustMarks.map((t) =>
    `<li class="rounded-pill border border-brand-hair px-3 py-1 text-xs font-semibold text-brand-slate">${esc(t)}</li>`
  ).join('\n');
}

function navLinks(current) {
  const items = [
    ['/', 'হোম'], ['/kk8-review.html', 'পূর্ণ রিভিউ'], ['/is-kk8-legit.html', 'KK8 কি নিরাপদ?'],
    ['/deposit-guide.html', 'ডিপোজিট গাইড'], ['/withdrawal-guide.html', 'উইথড্র গাইড'],
    ['/bonus-review.html', 'বোনাস রিভিউ'], ['/spot-fake-kk8-sites.html', 'ভুয়া সাইট চেনা'],
    ['/faq.html', 'FAQ'],
  ];
  return items.map(([href, label]) => {
    const active = (current === 'index' && href === '/') || href === `/${current}.html`;
    return `<li><a href="${href}" class="block px-3 py-2 text-sm font-semibold ${active
      ? 'text-brand-blue' : 'text-brand-navy hover:text-brand-blue'}"${active ? ' aria-current="page"' : ''}>${label}</a></li>`;
  }).join('\n');
}

/** Table of contents from the page body's h2s — editorial furniture. */
function toc(content) {
  const hs = [...content.matchAll(/<h2\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)];
  if (hs.length < 3) return '';
  return `<nav class="toc rounded-base border border-brand-hair bg-brand-tint p-5" aria-label="এই পেজের সূচিপত্র">
    <p class="mb-3 text-xs font-bold uppercase tracking-widest text-brand-blue">সূচিপত্র</p>
    <ol class="space-y-2">${hs.map(([, id, label]) =>
      `<li><a href="#${id}" class="text-sm text-brand-navy underline decoration-brand-hair hover:decoration-brand-blue">${label.replace(/<[^>]+>/g, '')}</a></li>`).join('')}</ol>
  </nav>`;
}

/** Editorial scorecard — honest criteria-based rating from site.config.json. */
function scorecard() {
  const r = cfg.editorialRating;
  return `<div class="rounded-base border border-brand-hair bg-white p-6">
    <div class="flex items-baseline gap-3 border-b border-brand-hair pb-4">
      <span class="text-4xl font-black text-brand-blue">${r.overall}</span>
      <span class="text-lg font-semibold text-brand-slate">/ ${r.best}</span>
      <span class="ml-auto text-xs font-semibold uppercase tracking-widest text-brand-slate">সম্পাদকীয় স্কোর</span>
    </div>
    <ul class="mt-4 space-y-3">${r.criteria.map((c) => `
      <li>
        <div class="flex items-baseline justify-between gap-4">
          <span class="text-sm font-semibold text-brand-navy">${esc(c.labelBn)}</span>
          <span class="text-sm font-bold text-brand-blue">${c.score}</span>
        </div>
        <div class="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-brand-tint">
          <div class="h-full rounded-pill bg-brand-blue" style="width:${(c.score / r.best) * 100}%"></div>
        </div>
        <p class="mt-1 text-xs leading-bn text-brand-slate">${esc(c.noteBn)}</p>
      </li>`).join('')}</ul>
    <p class="mt-5 border-t border-brand-hair pt-4 text-xs leading-bn text-brand-slate">${esc(r.methodologyBn)}</p>
  </div>`;
}

/* ------------------------------------------------------------------ schema */

function schemaBlocks(page) {
  const url = `${cfg.baseUrl}${page.slug === 'index' ? '/' : `/${page.slug}.html`}`;
  const out = [];

  if (page.schema.includes('Organization')) out.push({
    '@context': 'https://schema.org', '@type': 'Organization',
    name: cfg.brand, alternateName: cfg.siteName, url: cfg.baseUrl,
    logo: `${cfg.baseUrl}/assets/img/logo.png`,
    image: `${cfg.baseUrl}${cfg.ogImage}`,
    description: cfg.tagline,
    sameAs: [cfg.moneySite, cfg.sisterSite, cfg.social.facebook, cfg.social.instagram, cfg.social.telegram],
    areaServed: { '@type': 'Country', name: cfg.geo.country },
    hasCredential: {
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: 'Gaming Licence',
      recognizedBy: { '@type': 'Organization', name: `${cfg.licence.authority} — ${cfg.licence.text}` },
      identifier: cfg.licence.number,
    },
  });

  if (page.schema.includes('WebSite')) out.push({
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: cfg.siteName, alternateName: cfg.siteNameBn, url: cfg.baseUrl,
    inLanguage: cfg.hreflang,
    publisher: { '@type': 'Organization', name: cfg.brand },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${cfg.baseUrl}/faq.html?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  });

  if (page.schema.includes('Article')) out.push({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: page.h1,
    description: page.meta,
    inLanguage: cfg.hreflang,
    datePublished: cfg.lastVerified,
    dateModified: cfg.lastVerified,
    // Author is the editorial team, not an invented human. CLAUDE.md §9 asks for
    // Person; §4 forbids fake reviewed-by-author theatre. Until the client supplies a
    // real named reviewer, an Organization author is the honest reading of both.
    author: { '@type': 'Organization', name: cfg.author.nameBn, url: cfg.baseUrl },
    publisher: {
      '@type': 'Organization', name: cfg.publisher.nameBn,
      logo: { '@type': 'ImageObject', url: `${cfg.baseUrl}/assets/img/logo.png` },
    },
    image: `${cfg.baseUrl}${cfg.ogImage}`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    about: { '@type': 'Organization', name: cfg.brand },
  });

  if (page.schema.includes('Review')) out.push({
    '@context': 'https://schema.org', '@type': 'Review',
    itemReviewed: {
      '@type': 'Organization', name: cfg.brand, url: cfg.moneySite,
      areaServed: { '@type': 'Country', name: cfg.geo.country },
    },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: cfg.editorialRating.overall,
      bestRating: cfg.editorialRating.best,
      worstRating: 1,
    },
    author: { '@type': 'Organization', name: cfg.author.nameBn, url: cfg.baseUrl },
    publisher: { '@type': 'Organization', name: cfg.publisher.nameBn },
    datePublished: cfg.lastVerified,
    inLanguage: cfg.hreflang,
    reviewBody: page.meta,
    // No AggregateRating: it requires real user-rating counts. Fabricating them would
    // be invented data on a YMYL page. Deferred until genuine ratings exist.
  });

  if (page.schema.includes('BreadcrumbList')) out.push({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'হোম', item: `${cfg.baseUrl}/` },
      { '@type': 'ListItem', position: 2, name: page.h1, item: url },
    ],
  });

  if (page.schema.includes('FAQPage') && page.faq?.length) out.push({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    inLanguage: cfg.hreflang,
    mainEntity: page.faq.map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });

  return out.map((o) =>
    `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`).join('\n');
}

/* -------------------------------------------------------------------- head */

function head(page) {
  const url = `${cfg.baseUrl}${page.slug === 'index' ? '/' : `/${page.slug}.html`}`;
  return `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.meta)}">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="${cfg.hreflang}" href="${url}">
  <link rel="alternate" hreflang="x-default" href="${url}">
  <meta name="theme-color" content="${cfg.themeColor}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="rating" content="adult">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(cfg.siteName)}">
  <meta property="og:locale" content="${cfg.locale}">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.meta)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${cfg.baseUrl}${cfg.ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="${cfg.twitterSite}">
  <meta name="twitter:title" content="${esc(page.title)}">
  <meta name="twitter:description" content="${esc(page.meta)}">
  <meta name="twitter:image" content="${cfg.baseUrl}${cfg.ogImage}">
  <link rel="icon" href="/assets/img/favicon-32x32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon-180x180.png">
  <link rel="stylesheet" href="/assets/css/site.css">`;
}

/* ------------------------------------------------------------------- build */

const built = [];

for (const page of pages) {
  const src = `pages/${page.slug}.html`;
  if (!existsSync(join(ROOT, src))) { warns.push(`no source yet: ${src}`); continue; }

  const ctx = {
    ...cfg,
    page,
    head: head(page),
    schema: schemaBlocks(page),
    content: '',
    nav: navLinks(page.slug),
    providerGrid: providerGrid(),
    paymentList: paymentList(),
    categoryGrid: categoryGrid(),
    trustMarks: trustMarks(),
    moneyUrl: moneyUrl(),
    year: new Date().getFullYear(),
    bodyClass: `tpl-${page.template}`,
    scorecard: scorecard(),
  };

  let content = tokens(includes(read(src)), ctx, page.slug);
  ctx.toc = toc(content);

  const shell = `partials/shell-${page.template}.html`;
  if (existsSync(join(ROOT, shell))) {
    content = tokens(includes(read(shell)), { ...ctx, content }, page.slug);
  }

  const html = tokens(includes(partial('layout')), { ...ctx, content }, page.slug);
  const out = `${page.slug}.html`;
  writeFileSync(join(ROOT, out), html);
  built.push({ page, html, out });
}

/* ------------------------------------------------------- sitemap + robots */

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(ROOT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.w3.org/1999/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${built.map(({ page }) => {
  const url = `${cfg.baseUrl}${page.slug === 'index' ? '/' : `/${page.slug}.html`}`;
  return `  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
    <xhtml:link rel="alternate" hreflang="${cfg.hreflang}" href="${url}"/>
  </url>`;
}).join('\n')}
</urlset>
`.replace('http://www.w3.org/1999/sitemap/0.9', 'http://www.sitemaps.org/schemas/sitemap/0.9'));

writeFileSync(join(ROOT, 'robots.txt'),
`User-agent: *
Allow: /

Sitemap: ${cfg.baseUrl}/sitemap.xml
`);

/* ------------------------------------------------------------------- gates */

const seenTitles = new Map();
const seenMetas = new Map();

for (const { page, html, out } of built) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ')
                   .replace(/<style[\s\S]*?<\/style>/g, ' ')
                   .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // 1 — exactly one h1, carrying the brand
  const h1s = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g) || [];
  if (h1s.length !== 1) fail(out, 1, `expected 1 <h1>, found ${h1s.length}`);
  else if (!/KK8/i.test(h1s[0])) fail(out, 1, 'h1 does not contain the brand token "KK8"');

  // 1b — the Latin primary keyword must appear in the page (BD players type Latin)
  if (!text.toLowerCase().includes(page.primaryKeyword.toLowerCase()))
    fail(out, 1, `Latin primary keyword "${page.primaryKeyword}" absent from page text`);

  // 2 — title + meta present, unique, geo-signalled
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  if (!title) fail(out, 2, 'missing <title>');
  if (!desc) fail(out, 2, 'missing meta description');
  if (title) {
    if (seenTitles.has(title)) fail(out, 2, `duplicate title (also ${seenTitles.get(title)})`);
    seenTitles.set(title, out);
    if (!GEO_TOKENS.some((t) => title.includes(t))) fail(out, 2, 'no geo token in title');
  }
  if (desc) {
    if (seenMetas.has(desc)) fail(out, 2, `duplicate meta description (also ${seenMetas.get(desc)})`);
    seenMetas.set(desc, out);
  }

  // 3 — canonical present and on the configured domain
  const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  if (!canon) fail(out, 3, 'missing canonical');
  else if (!canon.startsWith(cfg.baseUrl)) fail(out, 3, `canonical off-domain: ${canon}`);

  // 4 — every JSON-LD block parses; required types present
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    try { JSON.parse(body); } catch (e) { fail(out, 4, `invalid JSON-LD: ${e.message}`); }
  }
  const types = blocks.flatMap(([, b]) => { try { return [JSON.parse(b)['@type']]; } catch { return []; } });
  for (const need of page.schema) {
    if (need === 'FAQPage' && !page.faq?.length) continue; // no questions authored yet
    if (!types.includes(need)) fail(out, 4, `declared schema ${need} not emitted`);
  }

  // 5 — every img has non-empty alt
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const alt = (tag.match(/\balt="([^"]*)"/) || [])[1];
    if (alt === undefined) fail(out, 5, `img without alt: ${tag.slice(0, 80)}`);
    else if (!alt.trim()) fail(out, 5, `img with empty alt: ${tag.slice(0, 80)}`);
  }

  // 6 — internal links resolve against the manifest
  const slugs = new Set(pages.map((p) => p.slug));
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    if (href.startsWith('/assets/')) continue;
    if (href === '/') continue;
    const m = href.match(/^\/([\w-]+)\.html$/);
    if (!m) { fail(out, 6, `unrecognised internal link: ${href}`); continue; }
    if (!slugs.has(m[1])) fail(out, 6, `internal link to unknown page: ${href}`);
  }

  // 7 — lang + hreflang hygiene. hreflang must never point at the sister domain.
  if (!/<html lang="bn">/.test(html)) fail(out, 7, 'missing <html lang="bn">');
  for (const [, hl, href] of html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)) {
    if (!href.startsWith(cfg.baseUrl))
      fail(out, 7, `hreflang "${hl}" points off-domain (${href}) — declares the two properties duplicates`);
  }

  // 9 — no Malaysia leakage, no Bangladesh legality claim
  if (/\bRM\s?\d/.test(text) || /\bMYR\b/.test(text)) fail(out, 9, 'MYR/RM figure in copy');
  for (const rail of ['FPX', 'Touch \'n Go', 'DuitNow', 'Boost']) {
    if (text.includes(rail)) fail(out, 9, `Malaysian payment rail "${rail}" in copy`);
  }
  if (/(বাংলাদেশে\s+(?:এটি\s+)?বৈধ|আইনত\s+বৈধ|legal\s+in\s+Bangladesh)/i.test(text))
    fail(out, 9, 'appears to claim gambling is legal in Bangladesh');
}

// 8 — cross-property duplicate body copy
const sibling = join(ROOT, '..', cfg.siteKey === 'seo' ? 'kk8-news' : 'kk8-site');
if (existsSync(sibling)) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const mine = new Map();
  for (const { html, out } of built)
    for (const [, p] of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
      const t = norm(p.replace(/<[^>]+>/g, ''));
      if (t.length > 80) mine.set(t, out);
    }
  let dup = 0;
  for (const f of readdirSync(sibling).filter((f) => f.endsWith('.html'))) {
    const other = readFileSync(join(sibling, f), 'utf8');
    for (const [, p] of other.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
      const t = norm(p.replace(/<[^>]+>/g, ''));
      if (t.length > 80 && mine.has(t)) {
        fail(mine.get(t), 8, `body paragraph duplicated in sibling property (${f}) — cannibalisation risk`);
        if (++dup > 5) break;
      }
    }
    if (dup > 5) break;
  }
} else {
  warns.push('gate 8 skipped — sibling property not built yet');
}

/* ------------------------------------------------------------------ report */

console.log(`\n  ${cfg.siteName}  (${cfg.domain})`);
console.log(`  built ${built.length}/${pages.length} pages · sitemap ${built.length} urls\n`);
for (const w of warns) console.log(`  ~ ${w}`);
if (errors.length) {
  console.error(`\n  ✗ ${errors.length} gate failure(s):\n`);
  for (const e of errors) console.error(`    ${e}`);
  console.error('');
  process.exit(1);
}
console.log(`  ✓ all gates passed\n`);
