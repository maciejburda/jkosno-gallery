# Jan Kosno (1913–1996) — Galeria 3D

Wirtualna galeria 3D z 164 obrazami Jana Kosno, pogrupowanymi w 9 sal tematycznych.
Statyczna strona (bez bazy danych), gotowa na GitHub Pages. Domyślna galeria 3D (`v2/`) renderuje
przez WebGPU (TypeGPU); klasyczna wersja WebGL/Three.js (`3d.html`) pozostaje dostępna — patrz niżej.

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

- `?sala=1..9` — wejście prosto do sali (`v2/?sala=3`; stare `3d.html?sala=3` też działa)
- `?obraz=N` — link do konkretnego obrazu: na stronie głównej otwiera lightbox,
  w galerii 3D stawia zwiedzającego przed obrazem (np. `v2/?obraz=49`);
  lightbox synchronizuje adres jako `#obraz-N`, więc link można po prostu skopiować z paska
- `?lang=pl|en` — wybór języka (zapamiętywany)

## Struktura

- `index.html` — strona główna: o malarzu, wejście do galerii 3D i klasyczny katalog
  wszystkich prac (ten sam podział na sale, lightbox ze szczegółami), responsywna (mobile-first)
- `v2/` — domyślna galeria 3D (WebGPU, build z `v2-src/`); deep-linki `v2/?sala=1..9`, `v2/?obraz=N`
- `3d.html` — klasyczna galeria 3D (Three.js/WebGL); bez wyboru wersji przekierowuje do `v2/`
- `assets/version.js` — wybór wersji galerii 3D (v2 domyślnie, v1 na życzenie)
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

## Galeria 3D: v2 (WebGPU, domyślna) i klasyczna v1

`/v2/` to galeria 3D napisana od zera na [TypeGPU](https://docs.swmansion.com/TypeGPU/)
(WebGPU, shadery w TypeScript) — **domyślna wersja**. Logika, UI, linki, i18n i analityka są takie same
jak w klasycznej `3d.html` (zdarzenia GA mają dodatkowo `gallery_version`).

Przełączanie wersji:
- strona główna: przełącznik „Galeria 3D: Nowa · WebGPU / Klasyczna” pod przyciskami (widoczny tylko
  tam, gdzie jest WebGPU); wszystkie linki do galerii (także sale i lightbox) prowadzą do wybranej wersji,
- w galeriach: na ekranie startowym v2 link „klasyczna wersja galerii (WebGL)”, w v1 „nowa wersja galerii (WebGPU)”,
- wybór zapamiętywany jest w `localStorage['kosno-3d']` (`v2` / `v1`); zdarzenie GA `gallery_version_switch`.

Stare linki `3d.html?sala=…` / `?obraz=…` automatycznie otwierają v2 (z tymi samymi parametrami),
chyba że odwiedzający wybrał wersję klasyczną, adres zawiera `?legacy=1` albo przeglądarka nie ma WebGPU.
Gdy WebGPU nie da się uruchomić, v2 sama przechodzi do `3d.html?…&legacy=1` (bez pętli przekierowań).
Wspólna logika wyboru: `assets/version.js`.

Co daje v2:
- cała architektura w jednym draw call, wszystkie obrazy w jednym instancjonowanym (≈15× mniej CPU na klatkę),
- podłogi pieczone na GPU (compute + `@typegpu/noise`), tynk liczony w przestrzeni świata (bez powtórzeń),
- światło nad każdym obrazem z miękkim cieniem ramy, analityczne AO, odbicia planarne (także na telefonach),
- HDR + MSAA 4×, PBR Neutral, bloom, dynamiczna rozdzielczość,
- Las Trzech Pań: instancjonowane pnie, Panie z mozaiki (oczy śledzą zwiedzającego), 90 tys. pociągnięć
  pędzla, liście i pył symulowane na GPU, filtr malarski (Kuwahara) i promienie światła.

Rozwój i budowanie (Node 20+):

```sh
cd v2-src
npm install
npm run dev      # http://localhost:5173 — obrazy z ../assets/img serwuje plugin Vite
npm run lint     # reguły eslint-plugin-typegpu
npm run build    # typecheck + build do ../v2/
```

**Ważne:** katalog `v2/` jest wynikiem builda i jest commitowany (GitHub Pages serwuje go
bez dodatkowej konfiguracji) — po każdej zmianie w `v2-src/` trzeba uruchomić `npm run build`
i zacommitować również `v2/`.

Parametry testowe: `?perf=1` — licznik FPS i rozdzielczości, `?scale=0.7` — stała skala renderu,
`?nogpu=1` — symulacja braku WebGPU (przekierowanie do `3d.html`). W konsoli: `__gallery`
(te same haki co w v1 + `tick(n)` do sterowania klatkami w ukrytej karcie).

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
