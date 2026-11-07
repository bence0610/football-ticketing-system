KTE Jegyportál – Alkalmazás Dokumentáció

Kecskeméti TE hivatalos jegyértékesítő és bérletkezelő platformja


1. Az Alkalmazásról
A KTE Jegyportál egy modern, full-stack webalkalmazás, amelyet kifejezetten a Kecskeméti TE szurkolói és a klub számára fejlesztünk. Az alkalmazás célja, hogy a hagyományos, elavult jegyvásárlási élményt felváltsa egy vizuálisan lebilincselő, interaktív és okos platformmal – amelyet a klub maga üzemeltet, saját márkája alatt.
A rendszer nem csupán egy egyszerű jegyértékesítő: egy komplex ökoszisztéma, amely összeköti a szurkolókat, a klubot és a stadiont – egyetlen, egységes digitális felületen.

2. Célfelhasználók
Felhasználói csoportIgénySzurkoló (vendég)Gyors, vizuális jegyvásárlás regisztráció nélkülRegisztrált szurkolóProfil, jegytörténet, loyalty pontok, bérletkezelésBérletes szurkolóBérlet kölcsönadása, digitális átruházásKlub adminisztrátorBevételi statisztikák, foglaltsági hőtérkép, várólisták kezelése

3. Alapfunkciók (MVP)
3.1 Vizuális Jegyvásárlás – 2.5D Stadiontérkép
Az alkalmazás szíve egy izometrikus (2.5D) SVG-alapú stadiontérkép, amely valós térbeli élményt nyújt. A felhasználó:

szektor szinten böngészhet (színkódolt szabad/foglalt/VIP helyek),
konkrét székre kattintva látja annak árát, kategóriáját és láthatóságát,
a kiválasztott helyet az alkalmazás ideiglenesen (5 percre) zárolja kosárba helyezéskor,
egy különleges kapcsolóval akadálymentes nézetbe válthat, ahol csak a kerekesszékes helyek aktívak.

3.2 Biztonságos Fizetés és E-jegy Generálás

Stripe API integráció szimulált bankkártyás fizetéssel,
sikeres fizetés után a rendszer egyedi QR-kódos e-jegyet generál,
a jegy e-mailben érkezik, és opcionálisan Apple Wallet / Google Pay formátumban (.pkpass) is letölthető.

3.3 Bérlet Kölcsönadó Rendszer
A bérletes szurkolók egy adott mérkőzésre digitálisan átruházhatják helyüket:

a bérletből ideiglenes QR-kód generálódik a kiválasztott mérkőzésre,
az átruházás regisztrált felhasználók között történik, e-mailes visszaigazolással,
a rendszer automatikusan feloldja az átruházást a mérkőzés után,
ha az átruházott jegy kiadásra kerül a közösségbe, a Várólistán szereplő szurkolók értesítést kapnak.

3.4 Profil- és Jogosultságkezelés

E-mailes regisztráció és bejelentkezés (JWT alapú, opcionális 2FA),
Saját profil: aktív jegyek, bérletek, vásárlási előzmények,
Loyalty pontegyenleg és szint megtekintése,
Biztonságos kijelentkezés és session kezelés.


4. Loyalty (Hűségprogram) Rendszer
A hűségprogram célja, hogy jutalmazzon minden interakciót, és erősítse a szurkolói elköteleződést.
Pontszerzési lehetőségek
EseményPontJegyvásárlás+50 pont / jegyBérletvásárlás+500 pontBérlet kölcsönadása+25 pontRegisztráció+100 pont (egyszeri)Profil kitöltése+50 pont (egyszeri)Meccsre bejelentkezés (QR scan)+10 pont
Szintek és jutalmak
SzintPonthatárJutalom🔵 Kék Szurkoló0–499 pontAlap hozzáférés⚪ Ezüst Szurkoló500–1499 pont5% kedvezmény jegyekre🟡 Arany Szurkoló1500–2999 pont10% kedvezmény, korai jegyelővétel🔴 KTE Legenda3000+ pont15% kedvezmény, VIP előtérhozzáférés, dedikált support
A pontok és szintek a felhasználó profiljában valós időben frissülnek, és az előfizetési évad végén részlegesen (50%) átvihetők a következő szezonba.

5. AI Chatbot Asszisztens
Az alkalmazásba beépített KTE Chatbot egy Claude API-alapú természetes nyelvi asszisztens, amely a szurkolók kérdéseire válaszol.
Képességei

Mérkőzés-információk: „Mikor játszik a KTE a Fradi ellen?" – a chatbot lekérdezi az aktuális menetrendet.
Jegyvásárlási segítség: „Melyik szektor a legjobb nézőpont a kapura?" – vizuális tanácsot ad a térképen.
Loyalty: „Hány pontom van? Mikor érem el az Arany szintet?" – profil adatokból válaszol.
Praktikus infók: parkolás, stadion megközelítése, étkezési lehetőségek, akadálymentesség.
Hibaelhárítás: „Nem kaptam meg a jegyet" – eligazítja a felhasználót a teendőkről.

Technikai megvalósítás

Anthropic Claude API (claude-sonnet-4-20250514 modell)
Beágyazott kontextus: az aktuális mérkőzésnapló, a felhasználó profilja és a loyalty szintje minden hívásba belekerül
A chatbot nem tárolja a korábbi beszélgetéseket a munkamenet lezárása után (GDPR-kompatibilis)
UI: lebegő chat widget a jobb alsó sarokban, minimalizálható


6. Okos Kiegészítő Funkciók
Időjárás-figyelmezető
Ha a megvásárolni kívánt szektorhoz tartozó terület fedetlen, és a mérkőzés napjára OpenWeatherMap API alapján csapadék várható, a rendszer egy figyelmeztető bannert jelenít meg a fizetési folyamat előtt. A felhasználónak lehetősége van fedett szektorra váltani.
Visszaszámláló a Főoldalon
A főoldal hero szekciójában egy élő visszaszámláló mutatja a következő hazai mérkőzés idejét napra, órára, percre pontosan. Amikor a számláló eléri a nullát, a „Jegyvásárlás" gomb átváltozik „A Mérkőzés Elkezdődött!" feliratúvá, és a gombon keresztül a kapunyitási információk érhetők el.
Várólistás Rendszer Telt Ház Esetén
Ha egy mérkőzésre minden jegy elfogy:

a vásárlás gomb átváltozik „Várólistára feliratkozom" gombra,
felszabaduló helynél (pl. bérletkölcsönzés) a várólistán elsőként álló szurkoló 10 perces időkorláttal értesítést kap e-mailben,
a 10 perc lejárta után a hely automatikusan a következő várakozónak kerül felajánlásra.

Dinamikus Árképzés
Az alapár a mérkőzés fontosságától, az ellenfél rangsorától és a maradék helyek számától függ. Ha kevesebb mint 15% hely szabad, az árak automatikusan 10–20%-kal emelkednek. Az aktuális ár mindig látható a térképen.

7. Technikai Architektúra
┌─────────────────────────────────────────────┐
│              FRONTEND (Angular)             │
│  - 2.5D SVG Stadiontérkép                  │
│  - Loyalty Dashboard                        │
│  - Chatbot Widget (Claude API)              │
│  - Valós idejű visszaszámláló (RxJS)        │
└────────────────────┬────────────────────────┘
                     │ REST API / WebSocket
┌────────────────────▼────────────────────────┐
│             BACKEND (NestJS / Node.js)      │
│  - Autentikáció (JWT, 2FA)                  │
│  - Jegy & Bérlet logika                     │
│  - Loyalty pontozási motor                  │
│  - Várólistás State Machine                 │
│  - E-mail küldés (Nodemailer)               │
│  - QR & .pkpass generálás                   │
└──────┬──────────────┬────────────┬──────────┘
       │              │            │
┌──────▼──┐   ┌───────▼───┐  ┌────▼──────────┐
│  MySQL  │   │   Redis   │  │  Külső API-k  │
│  (fő    │   │ (cache,   │  │  - Stripe     │
│  adatb.)│   │  zárolás) │  │  - OpenWeather│
└─────────┘   └───────────┘  │  - Claude API │
                              │  - SMTP       │
                              └───────────────┘
Technológiai Stack
RétegTechnológiaIndoklásFrontendAngular + TypeScriptKomponens alapú, kiváló SVG kezelés, erős typingBackendNestJS (Node.js)Moduláris, TypeScript natív, DI patternAdatbázisMySQLRelációs, tranzakció-képes, biztonságosCache / ZárolásRedisGyors ideiglenes foglalások, session storeFizetésStripe APIIpari standard, sandbox mód fejlesztéshezE-mailNodemailer + SMTPMegbízható, könnyen konfigurálhatóAI ChatbotAnthropic Claude APITermészetes nyelv, kontextus-érzékeny válaszokIdőjárásOpenWeatherMap APIIngyenes tier, pontos kecskeméti adatokJegyekQRCode.js + PassKitQR generálás és Apple Wallet .pkpass

8. Adatbázis Főbb Entitások

User – regisztrált felhasználó adatai, loyalty szint, pontegyenleg
Match – mérkőzés adatai (dátum, ellenfél, helyszín, kapunyitás)
Seat – szék rekord (szektor, sor, szám, kategória, akadálymentesség)
Ticket – megvásárolt jegy (user, meccs, szék, QR kód, státusz)
SeasonPass – bérlet (user, ülőhely, érvényességi időszak)
PassLoan – bérletkölcsönzési esemény (from_user, to_user, match, státusz)
LoyaltyTransaction – pont mozgások naplója
Waitlist – várólistás bejegyzések meccsenkénti sorban
ChatSession – chatbot munkamenet (nem perzisztens, csak analitikához)


9. Biztonsági Megfontolások

HTTPS kizárólagos kommunikáció (TLS 1.3)
JWT token rotáció lejárat és refresh token kezeléssel
Rate limiting az API végpontokon (Redis alapú, 100 req/perc/IP)
Ideiglenes foglalás zárolás (5 perces TTL Redis-ben – párhuzamos vásárlások megelőzése)
Stripe Webhook ellenőrzés (signature verification minden fizetésnél)
Input sanitizáció és SQL injection védelem (TypeORM ORM réteg)
GDPR: a chatbot nem tárolja a személyes üzeneteket munkamenet után


10. Szakdolgozati Értékek
Ez az alkalmazás több önálló fejezetet is megalapoz egy informatikai szakdolgozatban:

Rendszertervezés: Az egész alkalmazás architektúrájának és adatmodelljének megtervezése (ER diagram, komponens diagram, szekvencia diagramok).
UI/UX Design: A 2.5D izometrikus SVG térkép és az akadálymentes nézet tervezési döntései.
Külső API integráció: Stripe, OpenWeatherMap, Claude API – mindhárom eltérő integrációs mintát képvisel.
State Machine tervezés: A várólistás rendszer és a bérletkölcsönzés állapotgépként modellezhető és formálisan leírható.
Biztonsági tervezés: JWT, 2FA, rate limiting és a párhuzamos foglalások kezelése Redis-szel.
AI integráció: A Claude chatbot kontextus-kezelési stratégiájának és a prompttervezés elvének bemutatása.