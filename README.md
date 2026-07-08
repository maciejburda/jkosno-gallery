# Jan Kosno (1913–1996) — Galeria 3D

Wirtualna galeria 3D z 164 obrazami Jana Kosno, pogrupowanymi w 9 sal tematycznych.
Statyczna strona (bez bazy danych) — czysty HTML + Three.js, gotowa na GitHub Pages.

## Podgląd lokalny

Strona używa modułów ES, więc wymaga serwera HTTP (nie zadziała z `file://`):

```sh
python3 -m http.server 8123
# → http://localhost:8123
```

## Sterowanie

- **W A S D** / strzałki — chodzenie, **Q / E** — obrót w poziomie, **Shift** — bieg,
  **Spacja** — skok, mysz — rozglądanie (kliknij, aby wejść)
- najechanie na obraz — karta ze szczegółami; **N** — zbliżenie na najbliższy obraz i kolejne w pętli
- kliknięcie obrazu — zbliżenie; **Esc** / ruch — powrót
- **1–9** lub lista w prawym górnym rogu — skok do sali
- dotyk: lewa połowa ekranu = chodzenie (joystick), prawa = rozglądanie, dotknięcie obrazu = zbliżenie
- na ekranie startowym: przełącznik języka **PL/EN** i opcja odwróconej osi Y
- galeria skrywa też dwie niespodzianki — podpowiedź: rozglądaj się po podłodze w Sali I
  i przyjrzyj się „Trzem Paniom”

## Linkowanie

- `?sala=1..9` — wejście prosto do sali (`3d.html?sala=3`)
- `?obraz=N` — link do konkretnego obrazu: na stronie głównej otwiera lightbox,
  w `3d.html` stawia zwiedzającego przed obrazem (np. `3d.html?obraz=49`);
  lightbox synchronizuje adres jako `#obraz-N`, więc link można po prostu skopiować z paska
- `?lang=pl|en` — wybór języka (zapamiętywany)

## Struktura

- `index.html` — strona główna: o malarzu, wejście do galerii 3D i klasyczny katalog
  wszystkich prac (ten sam podział na sale, lightbox ze szczegółami), responsywna (mobile-first)
- `3d.html` — galeria 3D (scena, sterowanie, UI); obsługuje deep-linki `3d.html?sala=1..9`
- `assets/data.js` — dane 164 obrazów (tytuły PL/EN, wymiary, kategorie, status sprzedaży)
  wygenerowane z `Kosno - Obrazy/Kosno_katalog.html` i `_lista.txt`; ceny pokazywane są
  wyłącznie przy pracach sprzedanych
- `assets/i18n.js` — tłumaczenia PL/EN całego interfejsu
- `assets/img/s/` — tekstury 512 px (ładowane od razu, ~12 MB)
- `assets/img/l/` — tekstury 1400 px (doładowywane przy podejściu do obrazu, ~80 MB)
- `assets/three.module.js` — Three.js r160 (bez CDN, działa offline)
- `Kosno - Obrazy/` — oryginalne zdjęcia i katalog źródłowy (w `.gitignore`, niepotrzebne na stronie)

Obrazy wiszą w skali rzeczywistej (cm → m). Dla 84 prac bez zmierzonych wymiarów
rozmiar jest szacowany z proporcji zdjęcia (karta pokazuje wtedy „ok. … cm").
Sprzedane prace (obecnie № 049 „Jesienne impresje", Sopot 2021) mają czerwoną
kropkę na tabliczce i odznakę SPRZEDANY na karcie.

## Publikacja na GitHub Pages

```sh
git init && git add . && git commit -m "Galeria 3D Jana Kosno"
git branch -M main
git remote add origin git@github.com:<user>/kosno-gallery.git
git push -u origin main
```

Potem w ustawieniach repo: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
Strona będzie pod `https://<user>.github.io/kosno-gallery/` (strona główna),
galeria 3D pod `…/kosno-gallery/3d.html`.

## Aktualizacja danych

Ceny/status sprzedaży edytuje się bezpośrednio w `assets/data.js`
(pola `plnLo`, `plnHi`, `sold`, `soldInfo`).
