# Helyi telepítés

## Előfeltételek

- Node.js 24
- npm 10+
- MySQL 8 fut
- Redis 7 fut

## Lépések

```bash
# 1. Telepítés
npm run install:all

# 2. Környezeti változók
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
# Töltsd ki a DB jelszót, JWT secreteket, Stripe és Anthropic kulcsokat.

# 3. Adatbázis létrehozása (egyszer)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS kte_jegyportal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Migrációk + seed
npm run migration:run
npm run seed
# Létrejön: 2 mérkőzés, ~370 szék 4 szektorban,
# admin@kte.hu (Admin123!), fan@kte.hu (Fan12345!), kapu@kte.hu (Kapu123!).

# 5. Indítás
npm run start:all
# Backend  : http://localhost:3000
# Swagger  : http://localhost:3000/api/docs
# Frontend : http://localhost:4200
```

## Egészségellenőrzés

```bash
curl http://localhost:3000/health
# { "status": "ok", "checks": { "database": "up", "redis": "up" }, ... }
```

## Teljes vásárlás → belépés folyamat (kézi teszt)

1. Nyisd meg a frontenden: `http://localhost:4200`
2. Jelentkezz be **fan@kte.hu / Fan12345!** fiókkal.
3. Válassz egy mérkőzést → kattints egy szabad székre → Add kosárba → Fizetés.
4. Teszt kártyaadatok: `4242 4242 4242 4242`, lejárat `12/29`, CVC `123`.
5. Fizetés után menj a **Profil** oldalra → nyisd meg a jegy QR-párbeszédét (QR ikon).
6. A párbeszédben a QR kép alatt megjelenik a **token szövege** és egy **Másolás** gomb. Kattints rá.
7. Jelentkezz ki, majd jelentkezz be **kapu@kte.hu / Kapu123!** fiókkal.
8. Nyisd meg: `http://localhost:4200/gate`
9. Illeszd be a tokent a szövegmezőbe → **Ellenőrzés**.
   - Első beolvasás: zöld **„Belépés engedélyezve"** + mérkőzés és szék adatai.
10. Kattints **„Következő jegy"**, majd illeszd be ugyanazt a tokent újra → **„A jegy már be lett mutatva"**.

> **Megjegyzés:** a Stripe webhook-ot a Stripe CLI-vel kell továbbítani a helyi backendnek:
> ```bash
> stripe listen --forward-to localhost:3000/api/webhooks/stripe
> ```
> A kapott `whsec_...` értéket másold be az `apps/backend/.env` fájl `STRIPE_WEBHOOK_SECRET` mezőjébe.
