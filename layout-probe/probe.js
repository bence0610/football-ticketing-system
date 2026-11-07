/*
 * Read-only phone-width layout probe for KTE Jegyportál.
 *
 * Visits every page at 393 px and 360 px, collects layout findings and saves a
 * screenshot per page per width. It changes no application code and writes
 * nothing to the application database (seat locks are faked in the browser).
 *
 * Needs: ng serve on :4200 and the backend on :3000 with the seeded dev data.
 * Run:   node layout-probe/probe.js
 */
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require(
  path.join(__dirname, '..', 'apps', 'frontend', 'node_modules', '@playwright', 'test'),
);

const BASE = process.env.APP_BASE_URL || 'http://localhost:4200';
const API = 'http://localhost:3000/api';
const OUT = __dirname;
const SHOTS = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [
  { w: 393, h: 851 },
  { w: 360, h: 800 },
];

const ACCOUNTS = {
  fan: { email: 'fan@kte.hu', password: 'Fan12345!' },
  gate: { email: 'kapu@kte.hu', password: 'Kapu123!' },
  admin: { email: 'admin@kte.hu', password: 'Admin123!' },
};

/** Runs inside the page. Returns the findings for the current DOM. */
function collect(minTap) {
  const vw = document.documentElement.clientWidth;
  const out = { vw, hScroll: null, wide: [], clipped: [], overlaps: [], small: [], seatLike: null };

  const doc = document.documentElement;
  out.hScroll = {
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowPx: Math.max(doc.scrollWidth, document.body.scrollWidth) - vw,
    canScroll: (() => {
      const before = window.scrollX;
      window.scrollTo(200, window.scrollY);
      const moved = window.scrollX > 0;
      window.scrollTo(before, window.scrollY);
      return moved;
    })(),
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el) => {
    const parts = [];
    let cur = el;
    for (let i = 0; i < 4 && cur && cur.nodeType === 1 && cur !== document.body; i++) {
      let s = cur.tagName.toLowerCase();
      const tid = cur.getAttribute('data-testid');
      if (tid) s += `[data-testid=${tid}]`;
      else if (cur.id) s += `#${cur.id}`;
      else if (typeof cur.className === 'string' && cur.className.trim())
        s += '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.');
      parts.unshift(s);
      cur = cur.parentElement;
    }
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);
    return { path: parts.join(' > '), text };
  };
  // An ancestor that clips or scrolls horizontally hides the overflow: not a page problem.
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') {
        const r = p.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return true;
      }
    }
    return false;
  };

  const all = [...document.body.querySelectorAll('*')].filter(
    (el) => !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'PATH', 'CIRCLE', 'G'].includes(el.tagName.toUpperCase()),
  );

  // ── elements wider than / poking out of the viewport ──
  const offenders = new Set();
  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && r.right <= vw + 1) continue;
    if (r.right > vw + 1 || r.left < -1) {
      if (clippedByAncestor(el)) continue;
      offenders.add(el);
    }
  }
  for (const el of offenders) {
    if (el.parentElement && offenders.has(el.parentElement)) continue; // report the topmost only
    const r = el.getBoundingClientRect();
    const hiddenBy = (() => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'hidden' || ox === 'clip') return describe(p).path;
      }
      return null;
    })();
    out.wide.push({
      cutBy: hiddenBy,
      ...describe(el),
      width: Math.round(r.width),
      left: Math.round(r.left),
      right: Math.round(r.right),
      over: Math.round(Math.max(r.right - vw, -r.left)),
    });
  }

  // ── regions that scroll sideways ──
  out.hRegions = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && visible(el) && el.scrollWidth > el.clientWidth + 1) {
      out.hRegions.push({ ...describe(el), content: el.scrollWidth, shown: el.clientWidth });
    }
  }

  // ── clipped text ──
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const clipsX = ['hidden', 'clip'].includes(cs.overflowX);
    const clipsY = ['hidden', 'clip'].includes(cs.overflowY);
    if (clipsX && el.scrollWidth > el.clientWidth + 1) {
      out.clipped.push({
        ...describe(el),
        kind: cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'cut-off',
        hidden: el.scrollWidth - el.clientWidth,
      });
    } else if (clipsY && el.scrollHeight > el.clientHeight + 2) {
      out.clipped.push({ ...describe(el), kind: 'cut-off-vertical', hidden: el.scrollHeight - el.clientHeight });
    }
  }

  // ── overlapping text (leaf text elements that intersect) ──
  const leaves = all.filter((el) => {
    if (!visible(el)) return false;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  const rect = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return r.width && r.height ? r : el.getBoundingClientRect();
  };
  const rects = leaves.map(rect);
  let found = 0;
  for (let i = 0; i < leaves.length && found < 25; i++) {
    for (let j = i + 1; j < leaves.length && found < 25; j++) {
      const a = leaves[i], b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = rects[i], rb = rects[j];
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix <= 2 || iy <= 2) continue;
      const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (ix * iy < smaller * 0.25) continue;
      out.overlaps.push({ a: describe(a), b: describe(b), overlapPx: `${Math.round(ix)}x${Math.round(iy)}` });
      found++;
    }
  }

  // ── tap targets ──
  const interactiveSel =
    'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [role=menuitem], [role=checkbox], [role=radio], [role=option], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const cands = new Set(document.querySelectorAll(interactiveSel));
  for (const el of all) {
    if (getComputedStyle(el).cursor === 'pointer') {
      const parentPointer = el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer';
      if (!parentPointer) cands.add(el);
    }
  }
  const smallRows = [];
  for (const el of cands) {
    if (!visible(el)) continue;
    if (el.closest('[inert], [aria-hidden=true]') && !el.matches('input')) continue;
    const r = el.getBoundingClientRect();
    // text inputs are checked by height; others need both sides
    const tooSmall = r.width < minTap || r.height < minTap;
    if (!tooSmall) continue;
    // fully off-screen horizontally clipped things are reported elsewhere
    const d = describe(el);
    const key = d.path + '|' + d.text;
    if (seen.has(key)) continue;
    seen.add(key);
    smallRows.push({ ...d, w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase() });
  }
  // collapse repeats of the same shape (e.g. 500 identical seats) into one row with a count
  const groups = new Map();
  for (const s of smallRows) {
    const shape = `${s.tag}|${s.path.replace(/\d+/g, '#')}|${s.w}x${s.h}`;
    const g = groups.get(shape);
    if (g) g.count++;
    else groups.set(shape, { ...s, count: 1 });
  }
  out.small = [...groups.values()];

  // ── seat-map style repeated pointer targets ──
  const pointerTargets = [...cands].filter((el) => visible(el));
  out.seatLike = pointerTargets.length;
  return out;
}

/** Full-height screenshot even when the app scrolls inside a container:
 *  grow the viewport to the content height, shoot, shrink back. */
async function shot(page, file) {
  const vp = page.viewportSize();
  const need = await page.evaluate(() => {
    let max = 0;
    for (const e of document.querySelectorAll('*')) {
      const c = getComputedStyle(e);
      if ((c.overflowY === 'auto' || c.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 2) {
        const top = e.getBoundingClientRect().top;
        max = Math.max(max, Math.round(top + e.scrollHeight));
      }
    }
    return Math.max(max, document.documentElement.scrollHeight);
  });
  const height = Math.min(Math.max(vp.height, need), 7000);
  await page.setViewportSize({ width: vp.width, height });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, file), timeout: 30000 });
  await page.setViewportSize(vp);
  await page.waitForTimeout(200);
}

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    /* long-polling or websockets: carry on */
  }
  await page.waitForTimeout(900);
}

async function login(browser, who, vp) {
  const ctx = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    locale: 'hu-HU',
    timezoneId: 'Europe/Budapest',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('E-mail').fill(ACCOUNTS[who].email);
  await page.getByLabel('Jelszó', { exact: true }).fill(ACCOUNTS[who].password);
  await page.getByRole('button', { name: 'Bejelentkezés' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  return { ctx, page };
}

async function guestPage(browser, vp) {
  const ctx = await browser.newContext({
    ...devices['Pixel 5'],
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    locale: 'hu-HU',
    timezoneId: 'Europe/Budapest',
  });
  return { ctx, page: await ctx.newPage() };
}

async function main() {
  const matches = await (await fetch(`${API}/matches`)).json();
  const match = matches.find((m) => m.status === 'on_sale') || matches[0];
  const seats = await (await fetch(`${API}/matches/${match.id}/seats`)).json();
  const seatList = Array.isArray(seats) ? seats : seats.seats || [];
  const freeSeat = seatList.find((s) => (s.status || s.availability) === 'available') || seatList[0];

  const cartSnapshot = {
    version: 1,
    matchId: match.id,
    items: seatList.filter((s) => s.status === 'available').slice(0, 3).map((s, i) => ({
      seatId: s.id,
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      section: s.section,
      row: String(s.row),
      seatNumber: s.number,
      category: s.category || 'standard',
      price: s.price || match.basePrice,
      ownerToken: 'probe-owner-token-' + i,
      lockExpiresAtMs: Date.now() + 60 * 60 * 1000,
      addedAtMs: Date.now(),
    })),
  };

  const browser = await chromium.launch();
  const results = [];

  const PAGES = [
    // [name, role, path, extra]
    ['home', 'guest', '/'],
    ['stadium-seat-map', 'guest', `/stadium?matchId=${match.id}`, { seatMap: true }],
    ['cart', 'guest', '/cart', { cart: true }],
    ['login', 'guest', '/login'],
    ['register', 'guest', '/register'],
    ['season-pass', 'guest', '/season-pass'],
    ['not-found', 'guest', '/nincs-ilyen-oldal'],
    ['profile', 'fan', '/profile'],
    ['loyalty', 'fan', '/loyalty'],
    ['season-pass-signed-in', 'fan', '/season-pass'],
    ['checkout', 'fan', '/checkout', { cart: true, stripe: true }],
    ['gate', 'gate', '/gate'],
    ['admin', 'admin', '/admin'],
    ['admin-revenue', 'admin', '/admin/revenue'],
    ['admin-heatmap', 'admin', '/admin/heatmap'],
  ];

  for (const vp of WIDTHS) {
    const sessions = {};
    const getSession = async (role) => {
      if (!sessions[role]) {
        sessions[role] = role === 'guest' ? await guestPage(browser, vp) : await login(browser, role, vp);
      }
      return sessions[role];
    };

    for (const [name, role, route, extra = {}] of PAGES) {
      if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
      console.log(new Date().toISOString().slice(11, 19), vp.w, name);
      const { page } = await getSession(role);
      try {
        if (extra.cart) {
          await page.addInitScript((snap) => {
            try {
              sessionStorage.setItem('kte_cart_v1', JSON.stringify(snap));
            } catch {
              /* ignore */
            }
          }, cartSnapshot);
        }
        if (extra.stripe) {
          await page.route('**/payments/create-intent', (r) =>
            r.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                paymentIntentId: 'pi_probe',
                clientSecret: 'pi_probe_secret',
                currency: 'huf',
                amount: 10500,
                lineItems: [],
              }),
            }),
          );
          await page.addInitScript(() => {
            const el = { mount() {}, destroy() {}, on() {} };
            window.Stripe = () => ({
              elements: () => ({ create: () => el, submit: async () => ({ error: null }) }),
              confirmPayment: async () => ({ error: null }),
            });
          });
        }
        await page.goto(BASE + route);
        await settle(page);
        console.log('  loaded');
        const data = await page.evaluate(collect, 44);
        console.log('  collected');
        const file = `${name}__${vp.w}.png`;
        await shot(page, file);
        results.push({ name, role, route, width: vp.w, shot: `screenshots/${file}`, ...data });

        // seat map: select a sector, then a seat (lock request faked, nothing is written)
        if (extra.seatMap) {
          await page.route('**/lock', (r) =>
            r.request().method() === 'POST'
              ? r.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify({
                    seatId: freeSeat ? freeSeat.id : 'x',
                    ownerToken: 'probe-owner',
                    expiresAt: new Date(Date.now() + 600000).toISOString(),
                  }),
                })
              : r.continue(),
          );
          const step = async (label, note, action) => {
            let ok = true;
            try {
              await action();
              await page.waitForTimeout(900);
            } catch (e) {
              ok = false;
              note += ' — FAILED: ' + String(e).split(String.fromCharCode(10))[0].slice(0, 160);
            }
            const d = await page.evaluate(collect, 44);
            const f = `${name}-${label}__${vp.w}.png`;
            await shot(page, f);
            results.push({ name: `${name} (${label})`, role, route, width: vp.w, shot: `screenshots/${f}`, note, ...d });
            return ok;
          };
          const mapHeight = await page.evaluate(() => {
            const m = document.querySelector('svg.kte-map, .kte-map');
            if (!m) return null;
            const r = m.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          });
          await step('sector-opened', `stadium SVG map rendered at ${mapHeight ? mapHeight.w + 'x' + mapHeight.h : 'NOT FOUND'}; clicked sector A`, async () => {
            const sector = page.locator('g.kte-map__sector').first();
            await sector.scrollIntoViewIfNeeded({ timeout: 4000 });
            await sector.click({ timeout: 4000 });
          });
          const seatMetrics = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button.kte-seat')];
            const r = b.map((x) => x.getBoundingClientRect()).filter((x) => x.width);
            return { count: b.length, enabled: b.filter((x) => !x.disabled).length, minW: Math.min(...r.map((x) => x.width)), minH: Math.min(...r.map((x) => x.height)), rowW: Math.max(0, ...[...document.querySelectorAll('.kte-seat-grid__row-seats')].map((x) => x.scrollWidth)), rowShown: Math.min(...[...document.querySelectorAll('.kte-seat-grid__row-seats')].map((x) => x.clientWidth)) };
          });
          results[results.length - 1].seatMetrics = seatMetrics;
          await step('seat-selected', 'clicked the first enabled seat (bottom sheet expected)', async () => {
            const seat = page.locator('button.kte-seat:not([disabled])').first();
            await seat.scrollIntoViewIfNeeded({ timeout: 4000 });
            await seat.click({ timeout: 4000 });
          });
        }
      } catch (e) {
        results.push({ name, role, route, width: vp.w, error: String(e).slice(0, 300) });
      }
    }

    // ── app shell navigation: open the menu for guest, fan and admin ──
    for (const role of ['guest', 'fan', 'admin']) {
      const { page } = await getSession(role);
      try {
        await page.goto(BASE + '/');
        await settle(page);
        const toggle = page
          .locator('button[aria-label*="enü" i], button[aria-label*="menu" i], button:has(mat-icon:text-is("menu"))')
          .first();
        let opened = false;
        if (await toggle.count()) {
          await toggle.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(700);
          opened = true;
        }
        const data = await page.evaluate(collect, 44);
        const file = `app-shell-nav-${role}__${vp.w}.png`;
        await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
        results.push({
          name: `app-shell navigation (${role})`,
          role,
          route: '/',
          width: vp.w,
          shot: `screenshots/${file}`,
          note: opened ? 'menu toggle found and clicked' : 'NO menu toggle found at this width',
          ...data,
        });
      } catch (e) {
        results.push({ name: `app-shell navigation (${role})`, width: vp.w, error: String(e).slice(0, 300) });
      }
    }

    for (const s of Object.values(sessions)) await s.ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log('pages measured:', results.length, ' errors:', results.filter((r) => r.error).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
