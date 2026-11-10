import { describeBrowser, describeClient, maskIp } from './client-info';

describe('client info', () => {
  it('hides the last part of an address, never printing a full one', () => {
    expect(maskIp('84.2.51.77')).toBe('84.2.51.x');
    expect(maskIp('::ffff:84.2.51.77')).toBe('84.2.51.x');
    expect(maskIp('2a02:ab88:1234:5678::1')).toBe('2a02:ab88:1234:x');
    expect(maskIp('nonsense')).toBeUndefined();
    expect(maskIp(undefined)).toBeUndefined();
  });

  it('names browser and system when the User-Agent says so', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      ),
    ).toBe('Chrome, Windows');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari, iOS');
    expect(describeBrowser('curl/8.0')).toBeUndefined();
  });

  it('puts what it knows together, and says nothing when it knows nothing', () => {
    expect(
      describeClient({
        ip: '84.2.51.77',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0',
      }),
    ).toBe('Firefox, Linux · 84.2.51.x');
    expect(describeClient({ ip: '84.2.51.77' })).toBe('84.2.51.x');
    expect(describeClient({})).toBeUndefined();
    expect(describeClient(undefined)).toBeUndefined();
  });
});
