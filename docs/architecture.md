# Architektúra áttekintés - Iteration 1

## Monorepo

```
apps/
  backend/   NestJS 10 + TypeORM + ioredis + Stripe + Anthropic
  frontend/  Angular 17 standalone + Material + NgRx
.github/workflows/  CI pipeline
docs/      Tervezési és architektúra dokumentumok
```

## Backend modulok (NestJS)

| Modul       | Felelősség                                           | Iter. 1 állapot     |
| ----------- | ---------------------------------------------------- | ------------------- |
| `Health`    | Liveness, DB és Redis ping                            | Implementálva       |
| `Auth`      | JWT, register/login, 2FA                             | Skeleton            |
| `Users`     | Felhasználói profil, beállítások                      | Skeleton + count    |
| `Matches`   | Mérkőzések CRUD, listázás                            | Skeleton + read     |
| `Seats`     | Lelátó, székmaster                                    | Skeleton + read     |
| `Tickets`   | Egyedi jegy, QR, Apple Wallet                         | Skeleton            |
| `Loyalty`   | Pontok, szintek, jutalmak                            | Skeleton            |
| `Waitlist`  | Várólista értesítéssel                                | Skeleton            |
| `Admin`     | Admin panel végpontok                                 | Skeleton            |
| `Chatbot`   | Claude (claude-sonnet-4-20250514) integráció         | Skeleton            |

## Adatbázis entitások

| Entitás               | Kulcs kapcsolatok                              |
| --------------------- | ---------------------------------------------- |
| `User`                | hasMany Ticket, SeasonPass, LoyaltyTransaction |
| `Match`               | hasMany Ticket, Waitlist                       |
| `Seat`                | hasMany Ticket                                 |
| `Ticket`              | belongsTo Match, Seat, User, SeasonPass        |
| `SeasonPass`          | belongsTo User, Seat; hasMany PassLoan, Ticket |
| `PassLoan`            | belongsTo SeasonPass, Match, User (lender + borrower) |
| `LoyaltyTransaction`  | belongsTo User                                 |
| `Waitlist`            | belongsTo User, Match                          |

## Redis kulcsok

| Kulcs minta                          | TTL    | Cél                                            |
| ------------------------------------ | ------ | ---------------------------------------------- |
| `seat-lock:{matchId}:{seatId}`       | 300 s  | Atomikus székzárolás checkout idejére          |
| `refresh:{userId}:{jti}`             | 7 d    | Refresh token metaadatok (Iter. 2)             |
| `rate:{scope}:{identifier}`          | változó | Rate limiter sliding window (Iter. 2)         |

A kulcs prefix `kte:` (env-ből konfigurálható), tehát a teljes kulcs pl.
`kte:seat-lock:m1:s1`.

## Szerepkörök (UserRole)

| Érték         | Leírás                                                             |
| ------------- | ------------------------------------------------------------------ |
| `fan`         | Alapértelmezett. Jegyvásárlás, profil, hűségprogram.              |
| `gate`        | Beléptető operátor. Csak a `/gate` oldalt érheti el.              |
| `admin`       | Admin panel (`/admin`) + gate oldal.                              |
| `super_admin` | Teljes hozzáférés.                                                 |

A beléptetés folyamata: szurkoló QR token → `/gate` oldal → `PATCH /api/tickets/:id/scan` (szerepkör: gate/admin/super_admin) → token JWT-ellenőrzés (QrService) → jegy USED státuszra.

## Frontend útvonalak

| Útvonal       | Komponens         | Guard              |
| ------------- | ----------------- | ------------------ |
| `/`           | `HomePage`        | —                  |
| `/stadium`    | `StadiumPage`     | —                  |
| `/cart`       | `CartPage`        | —                  |
| `/checkout`   | `CheckoutPage`    | `authGuard`        |
| `/profile`    | `ProfilePage`     | `authGuard`        |
| `/gate`       | `GatePage`        | `gateGuard` (gate/admin/super_admin) |
| `/admin`      | `AdminPage`       | `adminGuard` (admin/super_admin) |
| `**`          | `NotFoundPage`    | 404                |

Minden komponens **standalone**, **OnPush** changeDetection.
