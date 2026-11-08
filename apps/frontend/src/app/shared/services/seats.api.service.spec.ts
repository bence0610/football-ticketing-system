import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { SeatsApiService } from './seats.api.service';

describe('SeatsApiService.extendLock', () => {
  it('sends only the owner token: the hold length is the server\'s, never the client\'s', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const api = TestBed.inject(SeatsApiService);
    const http = TestBed.inject(HttpTestingController);

    api.extendLock('m1', 's1', 'tok').subscribe();

    const req = http.expectOne((r) => r.url.endsWith('/matches/m1/seats/s1/lock/extend'));
    expect(req.request.method).toBe('POST');
    expect(req.request.params.keys()).toEqual(['ownerToken']);
    expect(req.request.params.get('ownerToken')).toBe('tok');
    req.flush({ matchId: 'm1', seatId: 's1', ownerToken: 'tok', ttlSeconds: 300, expiresAt: new Date().toISOString() });
    http.verify();
  });
});
