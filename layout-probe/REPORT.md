# Telefon-szélességű elrendezésvizsgálat (393 px és 360 px, Pixel 5 emuláció, Chromium)

Képernyőképek: `screenshots/<oldal>__<szélesség>.png` (40 db, teljes oldalmagasság).
Nyers adat: `results.json`. Futtatás: `node layout-probe/probe.js` (ng serve :4200 + backend :3000 kell).
Alkalmazáskód nem változott. Az adatbázisba nem írt (az ülés-zárolás a böngészőben hamisítva).

## Hibák súlyosság szerint
1. Fejléc (minden oldal): a "Bejelentkezés" gomb szövege kilóg a saját gombjából és a képernyő jobb szélén levágódik
   (a gomb 73 px/64 px széles, a szöveg szélesebb). Bejelentkezve a felhasználói menü jelvénye 360 px-en félig kilóg.
   A kosár-jelvény felül levágódik. A shell tartalma 3 px-szel szélesebb (396 > 393): oldalra görgethető.
2. Beléptető (/gate) 360 px-en: a súgószöveg 3 sorra tör és ráfed az "Ellenőrzés" gombra. A gomb szinte láthatatlan.
3. Chat-gomb (lebegő): minden oldalon rátakar a lábléc szövegére és a kártyák sarkára; az ülésadat-panelen
   (bottom sheet) eltakarja a "Bezárás" gombot.
4. Ülésválasztó: minden szék 28x28 px, ~4 px hézaggal (40 db külön jelölve, mind 28); az "akadálymentes" kapcsoló 36x14 px;
   a stadiontérkép feliratai (égtáj) ~5 px-esek; az ülésrács a térkép alatt ~450 px-rel, a szektor háromféleképp is választható
   (kártya, térkép, rács) és az oldal ~2200 px hosszú. Nem néztem, hogy szektorválasztás után az oldal odagörget-e.
5. Rendszerszintű: a Material gombok és linkek 36 px magasak (márkalogó, Bejelentkezés, Vissza a kosárhoz, Bezárás, Ellenőrzés),
   mind a 44 px alatt.
6. Kisebb: Fizetés oldal 360 px-en a "Vissza a kosárhoz" link 2 sorba törik; a profil lapfülei közül csak az első látszik;
   a meccsválasztó szövege levágja a dátumot; néhány ikon 2-9 px-szel levágva (arrow_drop_down, event_seat, calendar_today);
   admin heatmap feliratai nagyon kicsik.

## Téves jelzések (nem hibák)
- Beviteli mezők/mat-select "24 px": a mat-form-field maga 56 px, a tényleges érintési felület elég nagy.
- Átfedés a "szék kiválasztva" és a szektor-megnyitás állapotban: a félig átlátszó háttér és a ragadós fejléc, nem tördelési hiba.

## Amit NEM vizsgáltam
Profil jegyek/bérlet kártyák (a seed-fiókhoz nincs jegy vagy bérlet), kölcsön- és QR-párbeszédablak, chat megnyitva,
fekvő tájolás, valódi telefon, a Stripe kártyamező (hamisítva van), a Firefox telefon-nézete.
