import { readFileSync } from 'fs';
import { join } from 'path';
import { HANDLED_STRIPE_EVENTS } from './handled-stripe-events';

const quoted = (text: string): string[] =>
  [...text.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]).sort();

describe('handled Stripe events', () => {
  it('equals the case labels of PaymentsService.handleEvent', () => {
    const source = readFileSync(join(__dirname, 'payments.service.ts'), 'utf8');
    const start = source.indexOf('async handleEvent(');
    const end = source.indexOf('default:', start);
    expect(start).toBeGreaterThan(-1);
    const cases = [...source.slice(start, end).matchAll(/case '([^']+)'/g)].map((m) => m[1]).sort();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases).toEqual([...HANDLED_STRIPE_EVENTS].sort());
  });

  it('is what scripts/stripe-listen.js forwards (the script parses this very file)', () => {
    const script = readFileSync(join(__dirname, '../../../../../scripts/stripe-listen.js'), 'utf8');
    expect(script).toContain('handled-stripe-events.ts');
    const file = readFileSync(join(__dirname, 'handled-stripe-events.ts'), 'utf8');
    const block = file.split('// HANDLED_STRIPE_EVENTS:begin')[1].split('// HANDLED_STRIPE_EVENTS:end')[0];
    expect(quoted(block)).toEqual([...HANDLED_STRIPE_EVENTS].sort());
  });
});
