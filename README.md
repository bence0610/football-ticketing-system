# Football Ticketing System

Full-stack ticketing, season pass and loyalty platform for football clubs.

## Monorepo struktúra

```
.
├── apps
│   ├── backend     # NestJS API (TypeScript, TypeORM, MySQL, Redis, Stripe)
│   └── frontend    # Angular 17+ standalone components
├── docs            # Architektúra és tervezési dokumentumok
├── .github         # CI / GitHub Actions
└── package.json    # Root npm workspaces
```

## Tech stack

| Réteg          | Technológia                                         |
| -------------- | --------------------------------------------------- |
| Frontend       | Angular 17+ standalone, Angular Material, NgRx      |
| Backend        | NestJS 10+, TypeORM, class-validator                |
| Adatbázis      | MySQL 8+                                            |
| Cache / Lock   | Redis (ioredis)                                     |
| Fizetés        | Stripe (server-side)                                |
| AI             | Anthropic Claude (claude-sonnet-4-20250514)         |
| Email          | Nodemailer + SMTP                                   |
| Auth           | JWT (access + refresh) + opcionális TOTP 2FA        |

## Előfeltételek

- Node.js >= 24
- npm >= 10
- MySQL 8+ futó instance
- Redis 7+ futó instance

## Stripe CLI (fizetés teszteléshez)

1. Töltsd le innen: https://github.com/stripe/stripe-cli/releases
2. Csomagold ki ide: `C:\stripe`
3. Futtasd: `stripe login`
4. Futtasd: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
5. A kapott `whsec_...` kulcsot másold be az `apps/backend/.env` fájlba `STRIPE_WEBHOOK_SECRET` értékeként

## Teszt fizetés

| Mező   | Érték               |
| ------ | ------------------- |
| Kártya | 4242 4242 4242 4242 |
| Lejárat | 12/29              |
| CVC    | 123                 |

## Indítás

```powershell
# Szolgáltatások indítása (admin PowerShell)
net start mysql80
net start redis
```

```bash
# Telepítés
npm run install:all

# Környezeti változók
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env

# Adatbázis migráció és seed
npm run migration:run
npm run seed

# Indítás (backend + frontend párhuzamosan)
npm run start:all
```

- Backend: http://localhost:3000
- Swagger: http://localhost:3000/api/docs
- Frontend: http://localhost:4200

## Szkriptek

| Parancs                  | Leírás                                       |
| ------------------------ | -------------------------------------------- |
| `npm run start:all`      | Backend + frontend egyszerre                 |
| `npm run build:all`      | Mindkét app build                            |
| `npm run lint:all`       | ESLint mindkét appra                         |
| `npm run test:all`       | Unit tesztek mindkét appra                   |
| `npm run migration:run`  | TypeORM migrációk futtatása                  |
| `npm run seed`           | Seed adat betöltése (2 mérkőzés + székek + szekciók) |

## CI

A GitHub Actions pipeline (`.github/workflows/ci.yml`) lefuttatja a lint és unit teszt fázisokat mindkét appon, push és pull request eseményekre.
