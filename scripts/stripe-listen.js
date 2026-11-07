#!/usr/bin/env node
/**
 * Starts `stripe listen`, forwarding webhooks to the local backend.
 *
 * Uses whatever `stripe` is on PATH (Windows, macOS, Linux). If the Stripe CLI
 * is not installed, prints what to install and exits non-zero instead of
 * surfacing a raw spawn ENOENT.
 */
const { spawn } = require('child_process');
const { existsSync, statSync } = require('fs');
const path = require('path');

const FORWARD_TO = process.env.STRIPE_FORWARD_TO || 'localhost:3000/api/webhooks/stripe';

function findOnPath(name) {
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), name + ext.toLowerCase());
      const alt = path.join(dir.replace(/^"|"$/g, ''), name + ext);
      for (const file of [candidate, alt]) {
        try {
          if (existsSync(file) && statSync(file).isFile()) return file;
        } catch {
          /* unreadable PATH entry: skip */
        }
      }
    }
  }
  return null;
}

/**
 * The event types the backend handles live next to the handler, in
 * handled-stripe-events.ts. Read them from there so this list cannot drift;
 * a jest spec checks that file against PaymentsService.handleEvent.
 */
function handledEvents() {
  const file = path.join(
    __dirname,
    '..',
    'apps/backend/src/modules/payments/handled-stripe-events.ts',
  );
  const text = require('fs').readFileSync(file, 'utf8');
  const block = text.split('// HANDLED_STRIPE_EVENTS:begin')[1]?.split('// HANDLED_STRIPE_EVENTS:end')[0];
  const events = [...(block || '').matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]);
  if (events.length === 0) {
    console.error(`Nem olvasható esemény-lista / no events found in ${file}`);
    process.exit(1);
  }
  return events;
}

const stripe = findOnPath('stripe');

if (!stripe) {
  console.error(
    [
      '',
      'A Stripe CLI nem található a PATH-on (stripe CLI not found on PATH).',
      'Telepítsd, majd indítsd újra / Install it, then re-run:',
      '  Windows: scoop install stripe   (vagy: https://github.com/stripe/stripe-cli/releases)',
      '  macOS:   brew install stripe/stripe-cli/stripe',
      '  Linux:   https://docs.stripe.com/stripe-cli#install',
      'Utána / Then: stripe login',
      'A backend és a frontend enélkül is fut, de a Stripe webhookok nem érkeznek meg.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const EVENTS = handledEvents();
console.log(`Stripe events forwarded: ${EVENTS.join(', ')}`);

// .cmd/.bat shims (e.g. scoop) need a shell on Windows; real executables do not.
const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(stripe);
const child = needsShell
  ? spawn(`"${stripe}" listen --events ${EVENTS.join(',')} --forward-to "${FORWARD_TO}"`, {
      stdio: 'inherit',
      shell: true,
    })
  : spawn(stripe, ['listen', '--events', EVENTS.join(','), '--forward-to', FORWARD_TO], {
      stdio: 'inherit',
    });

child.on('error', (err) => {
  console.error(`A Stripe CLI nem indítható (${stripe}): ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 0 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
