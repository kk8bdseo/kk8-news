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
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const { pages } = JSON.parse(readFileSync(join(ROOT, 'pages.json'), 'utf8'));

// Launch switch. false = every page is noindex and robots.txt names no sitemap,
// so the client can review on the real domain before Google lists anything.
if (typeof cfg.indexing !== 'boolean')
  throw new Error('site.config.json: "indexing" must be true (live) or false (preview)');
const INDEXING = cfg.indexing;

// Languages. Bengali is the default and keeps the root URLs; every other language
// lives under its prefix (/en/). A page exists in a language when it has a manifest
// entry for that language (page.en) and a source file (pages/en/<slug>.html).
const LANGS = Object.keys(cfg.langs);
const DEFAULT_LANG = 'bn';
let LANG = DEFAULT_LANG;   // the language being rendered — partial() and the fragments read it
const L = (lang = LANG) => cfg.langs[lang];
const pagePath = (slug, lang = LANG) => `${L(lang).prefix}${slug === 'index' ? '/' : `/${slug}.html`}`;
const pageUrl = (slug, lang = LANG) => `${cfg.baseUrl}${pagePath(slug, lang)}`;
const srcOf = (slug, lang) => lang === DEFAULT_LANG ? `pages/${slug}.html` : `pages/${lang}/${slug}.html`;
const outOf = (slug, lang) => lang === DEFAULT_LANG ? `${slug}.html` : `${lang}/${slug}.html`;
/** A config field in the current language — `labelBn` / `labelEn`, else the plain key. */
const tr = (obj, key, lang = LANG) => obj?.[key + (lang === 'bn' ? 'Bn' : 'En')] ?? obj?.[key];

/** Interface strings the build itself writes (everything else lives in partials/pages). */
const UI = {
  bn: { home: 'হোম', provider: 'প্রোভাইডার', slotGame: (p) => `${p}-এর স্লট গেম`, language: 'ভাষা', country: 'বাংলাদেশ',
        tableHead: ['ক্যাটাগরি', 'সংখ্যা', 'প্রোভাইডার'], toc: 'সূচিপত্র', tocLabel: 'এই পেজের সূচিপত্র',
        editorialScore: 'সম্পাদকীয় স্কোর',
        nav: ['হোম', 'পূর্ণ রিভিউ', 'KK8 কি নিরাপদ?', 'ডিপোজিট গাইড', 'উইথড্র গাইড', 'বোনাস রিভিউ', 'ভুয়া সাইট চেনা', 'FAQ'] },
  en: { home: 'Home', provider: 'provider', slotGame: (p) => `slot game by ${p}`, language: 'Language', country: 'Bangladesh',
        tableHead: ['Category', 'Count', 'Providers'], toc: 'Contents', tocLabel: 'Contents of this page',
        editorialScore: 'Editorial score',
        nav: ['Home', 'Full review', 'Is KK8 safe?', 'Deposit guide', 'Withdrawal guide', 'Bonus review', 'Spot fake sites', 'FAQ'] },
};
const ui = () => UI[LANG];

const GEO_TOKENS = ['Bangladesh', 'বাংলাদেশ', 'বাংলাদেশে', 'BD'];
const errors = [];
const warns = [];
const fail = (slug, gate, msg) => errors.push(`[${slug}] gate ${gate}: ${msg}`);

/* ---------------------------------------------------------------- helpers */

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/** partials/en/<name>.html overrides partials/<name>.html on English pages. */
const partial = (name) => {
  const localised = `partials/${LANG}/${name}.html`;
  return read(LANG !== DEFAULT_LANG && existsSync(join(ROOT, localised)) ? localised : `partials/${name}.html`);
};
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

/** KK8's own provider cards (name + category label printed on the art). Lazy: every
 *  provider list sits below the fold. width/height reserve space, so nothing shifts. */
const providerCard = (p, g, liClass) => `<li class="${liClass}">
      <img src="${p.img}" alt="${esc(p.name)} — ${esc(tr(g, 'label'))} ${ui().provider}" width="${p.w}" height="${p.h}"
           loading="lazy" decoding="async" class="block h-auto w-full">
    </li>`;

/** One category's providers as a grid, for the page about that category. */
function providerGroup(id) {
  const g = (cfg.providerGroups || []).find((x) => x.id === id);
  if (!g) return '';
  return `<ul class="not-prose my-6 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
    ${g.providers.map((p) => providerCard(p, g, '')).join('\n    ')}
  </ul>`;
}

/** Editorial provider table. The hub shows providers as text, not KK8's card art:
 *  the art lives on kk8bd.site, and a table keeps this property visually its own. */
function providerTable() {
  return `<table class="data-table my-6">
  <thead><tr>${ui().tableHead.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>
${(cfg.providerGroups || []).map((g) => `    <tr><td><strong>${esc(tr(g, 'label'))}</strong></td><td>${g.providers.length}</td><td>${g.providers.map((p) => esc(p.name)).join(', ')}</td></tr>`).join('\n')}
  </tbody>
</table>`;
}

/** Every provider, grouped — the homepage overview. Mobile: one swipeable rail per
 *  category with the next card peeking in. Desktop: wraps into a grid, since sideways
 *  scrolling with a mouse is awkward. */
function providerGrid() {
  return (cfg.providerGroups || []).map((g) => `<div class="min-w-0">
    <p class="text-xs font-bold uppercase tracking-widest text-brand-blue">${esc(tr(g, 'label'))} <span class="text-brand-slate">· ${g.providers.length}</span></p>
    <ul class="carousel-track mt-3 flex snap-x gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-9 lg:overflow-visible">
    ${g.providers.map((p) => providerCard(p, g, 'w-[112px] shrink-0 snap-start lg:w-auto')).join('\n    ')}
    </ul>
  </div>`).join('\n');
}

function paymentList() {
  return cfg.paymentRails.map((r) =>
    `<li class="flex items-start gap-3 rounded-base border border-brand-hair bg-brand-tint p-4">
      <span class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-brand-blue" aria-hidden="true"></span>
      <span><strong class="font-bold text-brand-navy">${esc(tr(r, 'name'))}</strong>
      <span class="text-brand-slate">${tr(r, 'name') !== r.name ? ` (${esc(r.name)})` : ''} — ${esc(tr(r, 'type'))}</span></span>
    </li>`
  ).join('\n');
}

function categoryGrid() {
  return cfg.productCategories.map((c) =>
    `<li><a href="${pagePath('games-software')}"
      class="block rounded-base border border-brand-hair bg-white p-5 transition hover:border-brand-blue hover:shadow-sm">
      <span class="block text-lg font-bold text-brand-navy">${esc(tr(c, 'name'))}</span>${LANG === DEFAULT_LANG ? `
      <span class="mt-1 block text-sm text-brand-slate">${esc(c.name)}</span>` : ''}</a></li>`
  ).join('\n');
}

/** Featured games: KK8's own game-card art, self-hosted (never hotlinked) with client
 *  approval. Lazy-loaded; width/height reserve the slot so the grid never shifts. */
function gameGrid() {
  return cfg.featuredGames.map((g) => `<li>
      <a href="${moneyUrl()}" rel="nofollow noopener" target="_blank" class="group block">
        <img src="${g.img}" alt="${esc(g.name)} — ${esc(ui().slotGame(g.provider))}" width="${g.w}" height="${g.h}"
             loading="lazy" decoding="async" class="block h-auto w-full transition duration-200 group-hover:-translate-y-1">
        <p class="mt-1 truncate text-center text-sm font-bold text-brand-navy" title="${esc(g.name)}">${esc(g.name)}</p>
        <p class="text-center text-xs text-brand-slate">${esc(g.provider)}</p>
      </a>
    </li>`).join('\n');
}

function trustMarks() {
  return cfg.trustMarks.map((t) =>
    `<li class="rounded-pill border border-brand-hair px-3 py-1 text-xs font-semibold text-brand-slate">${esc(t)}</li>`
  ).join('\n');
}

function navLinks(current) {
  const slugs = ['index', 'kk8-review', 'is-kk8-legit', 'deposit-guide', 'withdrawal-guide', 'bonus-review', 'spot-fake-kk8-sites', 'faq'];
  return slugs.map((slug, i) => [slug, pagePath(slug), ui().nav[i]]).map(([slug, href, label]) => {
    const active = slug === current;
    return `<li><a href="${href}" class="block px-3 py-2 text-sm font-semibold ${active
      ? 'text-brand-blue' : 'text-brand-navy hover:text-brand-blue'}"${active ? ' aria-current="page"' : ''}>${label}</a></li>`;
  }).join('\n');
}

/** Table of contents from the page body's h2s — editorial furniture. */
function toc(content) {
  const hs = [...content.matchAll(/<h2\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)];
  if (hs.length < 3) return '';
  return `<nav class="toc rounded-base border border-brand-hair bg-brand-tint p-5" aria-label="${ui().tocLabel}">
    <p class="mb-3 text-xs font-bold uppercase tracking-widest text-brand-blue">${ui().toc}</p>
    <ol class="space-y-2">${hs.map(([, id, label]) =>
      `<li><a href="#${id}" class="text-sm text-brand-navy underline decoration-brand-hair hover:decoration-brand-blue">${label.replace(/<[^>]+>/g, '')}</a></li>`).join('')}</ol>
  </nav>`;
}

/** Editorial scorecard — criteria-based rating from site.config.json (visible only, no markup). */
function scorecard() {
  const r = cfg.editorialRating;
  return `<div class="rounded-base border border-brand-hair bg-white p-6">
    <div class="flex items-baseline gap-3 border-b border-brand-hair pb-4">
      <span class="text-4xl font-black text-brand-blue">${r.overall}</span>
      <span class="text-lg font-semibold text-brand-slate">/ ${r.best}</span>
      <span class="ml-auto text-xs font-semibold uppercase tracking-widest text-brand-slate">${ui().editorialScore}</span>
    </div>
    <ul class="mt-4 space-y-3">${r.criteria.map((c) => `
      <li>
        <div class="flex items-baseline justify-between gap-4">
          <span class="text-sm font-semibold text-brand-navy">${esc(tr(c, 'label'))}</span>
          <span class="text-sm font-bold text-brand-blue">${c.score}</span>
        </div>
        <div class="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-brand-tint">
          <div class="h-full rounded-pill bg-brand-blue" style="width:${(c.score / r.best) * 100}%"></div>
        </div>
        <p class="mt-1 text-xs leading-bn text-brand-slate">${esc(tr(c, 'note'))}</p>
      </li>`).join('')}</ul>
    <p class="mt-5 border-t border-brand-hair pt-4 text-xs leading-bn text-brand-slate">${esc(tr(r, 'methodology'))}</p>
  </div>`;
}

/** FAQ items read off the rendered page (faq-q button + its faq-a panel). The page is
 *  the single source of truth, so FAQPage schema can never drift from what visitors
 *  see — CLAUDE.md §9's "no schema-only claims". */
function extractFaq(html) {
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const [, id, q] of html.matchAll(/<button\b[^>]*class="faq-q"[^>]*aria-controls="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const a = html.match(new RegExp(`<div id="${id}" class="faq-a">([\\s\\S]*?)<\\/div>`));
    if (a) out.push({ q: strip(q.replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '')), a: strip(a[1]) });
  }
  return out;
}

/** Bangladesh flag, drawn inline — no image request, crisp at any size. */
const FLAG_BD = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" class="shrink-0">'
  + '<circle cx="10" cy="10" r="10" fill="#006a4e"/><circle cx="9" cy="10" r="4.6" fill="#f42a41"/></svg>';

/** Header language switcher: flag + current language; opens to the same page in each
 *  language it exists in. <details> works with no JavaScript; site.js only closes it on
 *  an outside click. Links carry hreflang and lang so crawlers read them as alternates. */
function langSwitch(slug) {
  // English first, matching the region/language picker on KK8's own platform.
  const options = [...LANGS].sort((a, b) => (b === 'en') - (a === 'en')).filter((l) => avail[l].has(slug)).map((l) => {
    const cur = l === LANG;
    return `<li><a href="${pagePath(slug, l)}" hreflang="${l}" lang="${l}" class="${cur
      ? 'font-bold text-brand-blue underline' : 'text-brand-navy hover:text-brand-blue'}"${cur ? ' aria-current="true"' : ''}>${cfg.langs[l].label}</a></li>`;
  }).join('<li aria-hidden="true" class="text-brand-hair">|</li>');
  return `<details class="lang-switch relative">
        <summary class="flex cursor-pointer items-center gap-1.5 rounded-pill border border-brand-hair px-2.5 py-1.5 text-xs font-bold text-brand-navy transition hover:border-brand-blue" aria-label="${ui().language}: ${L().label}">
          ${FLAG_BD}<span>${L().short}</span><span aria-hidden="true" class="text-[10px] text-brand-slate">▾</span>
        </summary>
        <div class="absolute right-0 z-50 mt-2 w-52 rounded-base border border-brand-hair bg-white p-4 shadow-lg">
          <p class="flex items-center gap-2 text-sm font-bold text-brand-navy">${FLAG_BD}${ui().country}</p>
          <ul class="mt-2 flex items-center gap-2 pl-7 text-sm">${options}</ul>
        </div>
      </details>`;
}

/* ------------------------------------------------------------------ schema */

function schemaBlocks(page) {
  const url = pageUrl(page.slug);
  const out = [];

  if (page.schema.includes('Organization')) out.push({
    '@context': 'https://schema.org', '@type': 'Organization',
    name: cfg.brand, alternateName: cfg.siteName, url: cfg.baseUrl,
    logo: `${cfg.baseUrl}/assets/img/logo.png`,
    image: `${cfg.baseUrl}${cfg.ogImage}`,
    description: tr(cfg, 'tagline'),
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
    name: cfg.siteName, alternateName: cfg.siteNameBn, url: pageUrl('index'),
    inLanguage: L().hreflang,
    publisher: { '@type': 'Organization', name: cfg.brand },
    // No SearchAction: neither site has a search, and Google retired the sitelinks
    // search box. Declaring one would be a schema-only claim (CLAUDE.md §9).
  });

  if (page.schema.includes('Article')) out.push({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: page.h1,
    description: page.meta,
    inLanguage: L().hreflang,
    datePublished: cfg.lastVerified,
    dateModified: cfg.lastVerified,
    // Author is the editorial team, not an invented human. CLAUDE.md §9 asks for
    // Person; §4 forbids fake reviewed-by-author theatre. Until the client supplies a
    // real named reviewer, an Organization author is the honest reading of both.
    author: { '@type': 'Organization', name: tr(cfg.author, 'name'), url: pageUrl('index') },
    publisher: {
      '@type': 'Organization', name: tr(cfg.publisher, 'name'),
      logo: { '@type': 'ImageObject', url: `${cfg.baseUrl}/assets/img/logo.png` },
    },
    image: `${cfg.baseUrl}${cfg.ogImage}`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    about: { '@type': 'Organization', name: cfg.brand },
  });

  // No Review or AggregateRating markup. The score is set by the brand's own team, and
  // Google's structured-data rules treat reviews of an Organization placed by that
  // organization (or a site it controls) as self-serving — a manual-action risk with
  // no rich result to gain. The scorecard stays as visible page content only.
  if (page.schema.includes('Review') || page.schema.includes('AggregateRating'))
    fail(`${page.slug}.html`, 4, 'Review/AggregateRating markup is self-serving on this property — remove it from pages.json');

  if (page.schema.includes('BreadcrumbList')) out.push({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ui().home, item: pageUrl('index') },
      { '@type': 'ListItem', position: 2, name: page.h1, item: url },
    ],
  });

  if (page.schema.includes('FAQPage') && page.faq?.length) out.push({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    inLanguage: L().hreflang,
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
  const url = pageUrl(page.slug);
  const twins = LANGS.filter((l) => avail[l].has(page.slug));
  const alternates = twins.map((l) =>
    `  <link rel="alternate" hreflang="${cfg.langs[l].hreflang}" href="${pageUrl(page.slug, l)}">`).join('\n');
  return `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.meta)}">
  <link rel="canonical" href="${url}">
${alternates}
  <link rel="alternate" hreflang="x-default" href="${pageUrl(page.slug, twins.includes(DEFAULT_LANG) ? DEFAULT_LANG : LANG)}">
  <meta name="theme-color" content="${cfg.themeColor}">
  <meta name="robots" content="${INDEXING ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">
  <meta name="rating" content="adult">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(cfg.siteName)}">
  <meta property="og:locale" content="${L().locale}">${twins.filter((l) => l !== LANG).map((l) => `
  <meta property="og:locale:alternate" content="${cfg.langs[l].locale}">`).join('')}
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

const avail = Object.fromEntries(LANGS.map((lang) => [lang, new Set(pages
  .filter((p) => (lang === DEFAULT_LANG || p[lang]) && existsSync(join(ROOT, srcOf(p.slug, lang))))
  .map((p) => p.slug))]));
const built = [];

for (const lang of LANGS) {
LANG = lang;
const missing = pages.filter((p) => !avail[lang].has(p.slug)).map((p) => p.slug);
if (missing.length) warns.push(`${lang}: ${missing.length} page(s) not built yet — ${missing.join(', ')}`);
if (lang !== DEFAULT_LANG) mkdirSync(join(ROOT, lang), { recursive: true });

for (const base of pages) {
  if (!avail[lang].has(base.slug)) continue;
  const page = { ...base, ...(lang === DEFAULT_LANG ? {} : base[lang]), lang };
  const src = srcOf(page.slug, lang);

  const ctx = {
    ...cfg,
    page,
    head: head(page),
    schema: '',
    content: '',
    lang,
    nav: navLinks(page.slug),
    langSwitch: langSwitch(page.slug),
    providerGrid: providerGrid(),
    providerCount: (cfg.providers || []).length,
    providerTable: providerTable(),
    providerGroups: Object.fromEntries((cfg.providerGroups || []).map((g) => [g.id, providerGroup(g.id)])),
    paymentList: paymentList(),
    categoryGrid: categoryGrid(),
    trustMarks: trustMarks(),
    gameGrid: gameGrid(),
    moneyUrl: moneyUrl(),
    year: new Date().getFullYear(),
    bodyClass: `tpl-${page.template}`,
    scorecard: scorecard(),
  };

  let content = tokens(includes(read(src)), ctx, page.slug);
  const onPageFaq = extractFaq(content);
  if (onPageFaq.length) page.faq = onPageFaq;
  ctx.schema = schemaBlocks(page);
  ctx.toc = toc(content);

  // Shells go through partial() so English pages get partials/en/shell-*.html.
  if (existsSync(join(ROOT, `partials/shell-${page.template}.html`))) {
    content = tokens(includes(partial(`shell-${page.template}`)), { ...ctx, content }, page.slug);
  }

  const html = tokens(includes(partial('layout')), { ...ctx, content }, page.slug);
  const out = outOf(page.slug, lang);
  writeFileSync(join(ROOT, out), html);
  built.push({ page, html, out, lang });
}
}
LANG = DEFAULT_LANG;

/* ---------------------------------------------- 404 page + redirect stubs */

// GitHub Pages serves /404.html for any missing path — including every address
// left over from whatever the domain hosted before. Never indexable.
{
  const notFound = read('partials/404.html');
  const head404 = `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>পেজটি খুঁজে পাওয়া যায়নি · Page not found | ${esc(cfg.siteName)}</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="${cfg.themeColor}">
  <link rel="icon" href="/assets/img/favicon-32x32.png" sizes="32x32">
  <link rel="stylesheet" href="/assets/css/site.css">`;
  const ctx404 = { ...cfg, lang: DEFAULT_LANG, nav: navLinks(''), langSwitch: langSwitch('index'), moneyUrl: moneyUrl(), year: new Date().getFullYear(),
    bodyClass: 'tpl-404', head: head404, schema: '', content: tokens(notFound, cfg, '404') };
  writeFileSync(join(ROOT, '404.html'), tokens(includes(partial('layout')), ctx404, '404'));
}

// Old addresses that have a true equivalent here. GitHub Pages cannot send a
// 301, so each gets a stub: an instant meta refresh, which Google treats as a
// permanent redirect, plus a canonical to the target. Removing an entry from
// site.config.json does not delete its folder — delete that by hand.
const STUB_ROOT_BLOCKED = /^\/(assets|pages|partials|src|node_modules)\//;
for (const [from, to] of Object.entries(cfg.redirects || {})) {
  if (!/^\/[\w-]+(\/[\w-]+)*\/$/.test(from) || STUB_ROOT_BLOCKED.test(from)) {
    fail('redirects', 6, `invalid redirect source "${from}" — use /folder/ form, outside build folders`);
    continue;
  }
  const m = to === '/' ? ['', 'index'] : to.match(/^\/([\w-]+)\.html$/);
  if (!m || !pages.some((p) => p.slug === m[1])) {
    fail('redirects', 6, `redirect ${from} → ${to}: target is not a page in pages.json`);
    continue;
  }
  const target = `${cfg.baseUrl}${to}`;
  mkdirSync(join(ROOT, from), { recursive: true });
  writeFileSync(join(ROOT, from, 'index.html'), `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <title>${esc(cfg.siteName)}</title>
  <link rel="canonical" href="${target}">
  <meta http-equiv="refresh" content="0; url=${to}">
</head>
<body><p><a href="${to}">${esc(cfg.siteName)}</a></p></body>
</html>
`);
}

/* ------------------------------------------------------- sitemap + robots */

const today = new Date().toISOString().slice(0, 10);

/** When the page's own source last changed — not the build date. A lastmod that
 *  moves on every build tells Google nothing, and Google learns to ignore it. */
function lastmod(src) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    if (git('status', '--porcelain', '--', src)) return today;   // uncommitted edit
    return git('log', '-1', '--format=%cs', '--', src) || today;
  } catch { return today; }
}
writeFileSync(join(ROOT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.w3.org/1999/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${built.map(({ page, lang }) => {
  const twins = LANGS.filter((l) => avail[l].has(page.slug));
  return `  <url>
    <loc>${pageUrl(page.slug, lang)}</loc>
    <lastmod>${lastmod(srcOf(page.slug, lang))}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
${twins.map((l) => `    <xhtml:link rel="alternate" hreflang="${cfg.langs[l].hreflang}" href="${pageUrl(page.slug, l)}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(page.slug, twins.includes(DEFAULT_LANG) ? DEFAULT_LANG : lang)}"/>
  </url>`;
}).join('\n')}
</urlset>
`.replace('http://www.w3.org/1999/sitemap/0.9', 'http://www.sitemaps.org/schemas/sitemap/0.9'));

writeFileSync(join(ROOT, 'robots.txt'),
`User-agent: *
Allow: /
${INDEXING ? `\nSitemap: ${cfg.baseUrl}/sitemap.xml\n` : '# Preview: every page is noindex until launch (site.config.json "indexing").\n'}`);

/* ------------------------------------------------------------------- gates */

const seenTitles = new Map();
const seenMetas = new Map();

const builtUrls = new Set(built.map(({ page, lang }) => pageUrl(page.slug, lang)));
const PREFIXED = new RegExp(`^/(${LANGS.filter((l) => l !== DEFAULT_LANG).join('|')})(/.*)$`);

for (const { page, html, out, lang } of built) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ')
                   .replace(/<style[\s\S]*?<\/style>/g, ' ')
                   .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // 12 — one robots meta, and it matches the launch switch
  const robots = [...html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);
  if (robots.length !== 1) fail(out, 12, `expected 1 robots meta, found ${robots.length}`);
  else if (INDEXING === robots[0].includes('noindex'))
    fail(out, 12, `robots "${robots[0]}" contradicts "indexing": ${INDEXING}`);

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

  // 6 — internal links resolve to a built page, in this page's own language. Only the
  //     language switcher may cross languages; anything else is an untranslated link.
  const outsideSwitch = html.replace(/<details class="lang-switch[\s\S]*?<\/details>/g, '');
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    if (href.startsWith('/assets/')) continue;
    const pre = href.match(PREFIXED);
    const l = pre ? pre[1] : DEFAULT_LANG;
    const m = (pre ? pre[2] : href).match(/^\/(?:([\w-]+)\.html)?$/);
    if (!m) { fail(out, 6, `unrecognised internal link: ${href}`); continue; }
    if (!avail[l]?.has(m[1] || 'index')) fail(out, 6, `internal link to a page not built in ${l}: ${href}`);
  }
  for (const [, href] of outsideSwitch.matchAll(/href="(\/[^"#?]*)"/g)) {
    if (href.startsWith('/assets/')) continue;
    const l = (href.match(PREFIXED) || [])[1] || DEFAULT_LANG;
    if (l !== lang) fail(out, 6, `links into the ${l} site outside the language switcher: ${href}`);
  }

  // 7 — lang + hreflang hygiene. hreflang must never point at the sister domain.
  if (!new RegExp(`<html lang="${lang}">`).test(html)) fail(out, 7, `missing <html lang="${lang}">`);
  for (const [, hl, href] of html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)) {
    if (!href.startsWith(cfg.baseUrl))
      fail(out, 7, `hreflang "${hl}" points off-domain (${href}) — declares the two properties duplicates`);
    else if (!builtUrls.has(href)) fail(out, 7, `hreflang "${hl}" points at a page that was not built: ${href}`);
  }

  // 13 — a translated page carries no Bengali outside the switcher's "বাংলা" link. A hit
  //      means a partial or fragment fell back to the Bengali version.
  if (lang !== DEFAULT_LANG) {
    const visible = outsideSwitch.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
    const bn = visible.match(/[\u0980-\u09FF][\u0980-\u09FF\s]{0,30}/);
    if (bn) fail(out, 13, `Bengali text on a ${lang} page: "${bn[0].trim()}"`);
  }

  // 11 — structural tags balance. An unclosed <button> or <div> silently swallows the
  //      rest of an FAQ block, and the FAQ schema extracted from it goes wrong with it.
  for (const tag of ['div', 'section', 'button', 'ul', 'ol', 'li', 'table', 'tr', 'a', 'h1', 'h2', 'h3', 'p', 'nav', 'aside']) {
    const open = (html.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) fail(out, 11, `<${tag}> opened ${open}× but closed ${close}×`);
  }

  // 9 — no Malaysia leakage, no Bangladesh legality claim
  if (/\bRM\s?\d/.test(text) || /\bMYR\b/.test(text)) fail(out, 9, 'MYR/RM figure in copy');
  for (const rail of ['FPX', 'Touch \'n Go', 'DuitNow', 'Boost']) {
    if (text.includes(rail)) fail(out, 9, `Malaysian payment rail "${rail}" in copy`);
  }
  if (/(বাংলাদেশে\s+(?:এটি\s+)?বৈধ|আইনত\s+বৈধ|legal\s+in\s+Bangladesh)/i.test(text))
    fail(out, 9, 'appears to claim gambling is legal in Bangladesh');
}

// 10 — a primary keyword may be targeted by exactly one page across BOTH properties.
//      Two pages on one query compete for one slot; that is the collapse the two-site
//      architecture exists to prevent (spec §5.1).
{
  const mine = new Map();
  for (const p of pages) {
    const k = p.primaryKeyword.toLowerCase().trim();
    if (mine.has(k)) fail(`${p.slug}.html`, 10, `primary keyword "${k}" also targeted by ${mine.get(k)}.html on this site`);
    mine.set(k, p.slug);
  }
  const theirsFile = join(ROOT, '..', cfg.siteKey === 'seo' ? 'kk8-news' : 'kk8-site', 'pages.json');
  if (existsSync(theirsFile)) {
    for (const p of JSON.parse(readFileSync(theirsFile, 'utf8')).pages) {
      const k = p.primaryKeyword.toLowerCase().trim();
      if (mine.has(k)) fail(`${mine.get(k)}.html`, 10, `primary keyword "${k}" also targeted by the sister property (${p.slug})`);
    }
  }
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
  const siblingFiles = [sibling, ...LANGS.filter((l) => l !== DEFAULT_LANG).map((l) => join(sibling, l))]
    .filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.html')).map((f) => join(d, f)));
  for (const file of siblingFiles) {
    const f = file.slice(sibling.length + 1);
    const other = readFileSync(file, 'utf8');
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
console.log(`  built ${LANGS.map((l) => `${l} ${avail[l].size}/${pages.length}`).join(' · ')} · sitemap ${built.length} urls · 404 page · ${Object.keys(cfg.redirects || {}).length} redirects\n`);
for (const w of warns) console.log(`  ~ ${w}`);
if (errors.length) {
  console.error(`\n  ✗ ${errors.length} gate failure(s):\n`);
  for (const e of errors) console.error(`    ${e}`);
  console.error('');
  process.exit(1);
}
console.log(`  ✓ all gates passed\n`);
if (!INDEXING) console.log(`  ⚠ PREVIEW MODE — every page is noindex and robots.txt names no sitemap.
    At launch: set "indexing": true in site.config.json, rebuild, push.\n`);
