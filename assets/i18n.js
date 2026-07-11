// Wspólne tłumaczenia PL/EN dla strony głównej i galerii 3D.
export function getLang(){
  const q = new URLSearchParams(location.search).get('lang');
  if(q === 'pl' || q === 'en'){ localStorage.setItem('kosno-lang', q); return q; }
  return localStorage.getItem('kosno-lang') || 'pl';
}
export function setLang(l){
  localStorage.setItem('kosno-lang', l);
  const u = new URL(location.href); u.searchParams.delete('lang');
  location.href = u.toString();
}

export const GROUPS_EN = {
  'Paryż i Wenecja':'Paris & Venice', 'Pejzaże':'Landscapes', 'Tatry i góry':'Tatras & Mountains',
  'Miasta polskie':'Polish Cities', 'Mariny':'Seascapes', 'Impresje i abstrakcje':'Impressions & Abstractions',
  'Sceny i symbolizm':'Scenes & Symbolism', 'Portrety i akty':'Portraits & Nudes',
  'Rysunki i dyptyki':'Drawings & Diptychs',
};
export const CATS_EN = {
  'Portret':'Portrait', 'Wenecja':'Venice', 'Marina':'Seascape', 'Marina (cykl)':'Seascape (series)',
  'Pejzaż':'Landscape', 'Impresja/abstrakcja':'Impression / abstraction', 'Tatry/góry':'Tatras / mountains',
  'Scena figuralna':'Figural scene', 'Paryż':'Paris', 'Miasto PL':'Polish city', 'Akt':'Nude',
  'Surrealizm/symbolizm':'Surrealism / symbolism', 'Rysunek/szkic':'Drawing / sketch',
  'Cykl dekoracyjny':'Decorative series', 'Tatry (akwarela)':'Tatras (watercolour)',
  'Tatry (akwarela?)':'Tatras (watercolour?)', 'Dyptyk':'Diptych', 'Autoportret':'Self-portrait',
  'Religijne':'Religious', 'Martwa natura':'Still life', 'Tatry (góra)':'Tatras (mountain)',
  'Portret (dwustronny)':'Portrait (double-sided)',
};
export const SUPPORTS_EN = { 'Olej/płótno':'Oil on canvas' };

export const STR = {
pl: {
  // wspólne
  soldBadge:'SPRZEDANY', sold:'Sprzedany', approx:'ok.', works:'prac', room:'Sala', entrance:'Wejście',
  title3d:'Jan Kosno (1913–1996) — Galeria 3D',
  titleMain:'Jan Kosno (1913–1996) — Galeria',
  // strona główna
  brandSub:'1913–1996 · malarstwo', navAbout:'O malarzu', navCollection:'Kolekcja', nav3d:'Galeria 3D',
  kicker:'Kolekcja rodzinna · {n} prace', heroLead:'Malarz i rysownik związany z krakowskim i śląskim środowiskiem artystycznym. <b>Paryż lat 1968–1970, Wenecja, Tatry</b> — a obok nich impresje, abstrakcje i sceny symboliczne. Cała spuścizna zebrana w&nbsp;wirtualnym muzeum o dziewięciu salach.',
  ctaEnter:'Wejdź do galerii 3D', ctaBrowse:'Przeglądaj katalog ↓',
  statWorks:'prace', statRooms:'sal tematycznych', statParis:'okres paryski',
  portraitCap:'<b>Autoportret</b> · № 107 · olej na płótnie',
  aboutH:'O malarzu',
  bio1:'Jan Kosno tworzył przez ponad pół wieku — od przedwojennych pejzaży podmiejskich po ekspresyjne impresje lat dziewięćdziesiątych. Związany z krakowskim i śląskim środowiskiem artystycznym oraz z Krakowską Grupą Twórczą ZPAP „Postawy”, pozostawił po sobie spójny, rozpoznawalny język malarski: wibrujący kolor, rozedrgane światło i pejzaż na granicy abstrakcji.',
  bio2:'Na przełomie lat 60. i 70. pracował w Paryżu. Powstały wówczas cykle znad Sekwany i z Marché aux Puces, widoki dachów miasta oraz portrety paryskiej bohemy — hipisów, muzyków, bukinistów.',
  bio3:'Malował Wenecję, Tatry, polskie miasta i morze. W dojrzałej twórczości coraz śmielej sięgał po czystą impresję i symbol: płonące zbocza gór, supernowe, witraże dusz. Wystawę „Rysunek i malarstwo Jana Kosno” pokazała Galeria Extravagance w Zamku Sieleckim w Sosnowcu (2002).',
  quote:'Malarz ruchu — światła, które nie stoi w miejscu.', quoteSub:'o twórczości Jana Kosno',
  bannerH:'Przejdź się po wirtualnym muzeum',
  bannerP:'Dziewięć sal, obrazy w rzeczywistej skali i historia każdej pracy. Na komputerze: klawisze W A S D i mysz. Na telefonie: sterowanie dotykiem.',
  collectionH:'Kolekcja', see3d:'Zobacz salę w 3D →', seeIn3d:'zobacz w galerii 3D →',
  footerL:'© Rodzina Jana Kosno · kolekcja prywatna', footerCat:'Katalog',
  lbClose:'Zamknij', lbPrev:'Poprzedni', lbNext:'Następny',
  // 3D
  introKicker:'Wirtualna galeria', introSub:'1913–1996 · {n} prace · 9 sal tematycznych',
  howto:'Jak zwiedzać',
  cWalkH:'Chodzenie', cWalkP:'<b>W A S D</b> lub strzałki.<br><b>Shift</b> — bieg, <b>Spacja</b> — skok.',
  cLookH:'Rozglądanie', cLookP:'Kliknij i poruszaj myszą.<br><b>Q</b> / <b>E</b> — obrót w poziomie.',
  cArtH:'Obrazy', cArtP:'Spójrz na obraz — szczegóły. Klik lub <b>N</b> — zbliżenie i kolejne prace, <b>Esc</b> — powrót.',
  cRoomsH:'Sale', cRoomsP:'Klawisze <b>1</b>–<b>9</b> albo lista w prawym górnym rogu.',
  tWalkH:'Chodzenie', tWalkP:'Przeciągnij palcem po <u>lewej</u> połowie ekranu — pojawi się joystick. Skok — okrągły przycisk przy prawej krawędzi.',
  tLookH:'Rozglądanie', tLookP:'Przeciągaj palcem po <u>prawej</u> połowie ekranu.',
  tArtH:'Obrazy i sale', tArtP:'Dotknij obrazu — szczegóły i zbliżenie. Sale wybierzesz z listy u góry ekranu.',
  invertY:'Odwrócona oś Y (mysz)', enter:'Wejdź do galerii', loading:'wczytywanie obrazów…', ready:'gotowe',
  back:'← wróć na stronę główną', backTop:'← strona główna', brand3dSub:'1913–1996 · galeria 3D',
  hint:'Poruszanie: <b>W A S D</b> · obrót: <b>Q E</b> · skok: <b>Spacja</b> · <b>N</b> — kolejny obraz · <b>klik</b> = zbliżenie',
  plaqueWorks:'prac', lobbyLine:'MALARSTWO · {n} PRACE · 9 SAL',
  aboutPainter:'O  M A L A R Z U',
  bioPanel1:'Malarz i rysownik, związany z krakowskim i śląskim środowiskiem artystycznym oraz z Krakowską Grupą Twórczą ZPAP „Postawy”.',
  bioPanel2:'Na przełomie lat 60. i 70. pracował w Paryżu — powstały wówczas cykle znad Sekwany, z Marché aux Puces i widoki dachów miasta. Malował Wenecję, Tatry, polskie miasta i morze; obok pejzaży tworzył impresje, abstrakcje i sceny symboliczne.',
  bioPanel3:'Wystawę „Rysunek i malarstwo Jana Kosno” pokazała Galeria Extravagance w Zamku Sieleckim w Sosnowcu (2002).',
  bioPanel4:'Kolekcja obejmuje {n} prace w dziewięciu salach.',
  selfPortrait:'JAN KOSNO · AUTOPORTRET',
  keyFound:'Znalazłeś niebieski klucz…', secretOpen:'Sekretne przejście stoi otworem!',
  okeyFound:'Znalazłeś pomarańczowy klucz… „Trzy Panie” czekają.',
  locked52:'Coś tu jest ukryte — ale potrzebny jest klucz.',
  secretRoom:'Sala sekretna', secretHint:'Coś tu zgrzytnęło — spróbuj podskoczyć przy ścianie.',
  forestBack:'Dotknij ramy, aby wrócić do galerii', forestName:'Las Trzech Pań',
  consentText:'Ta strona używa Google Analytics (pliki cookie) do pomiaru odwiedzin oraz personalizacji i pomiaru reklam. Możesz zmienić decyzję w każdej chwili w stopce strony.',
  consentAccept:'Zgadzam się', consentDeny:'Tylko niezbędne', privacy:'Ustawienia prywatności',
},
en: {
  soldBadge:'SOLD', sold:'Sold', approx:'c.', works:'works', room:'Room', entrance:'Entrance',
  title3d:'Jan Kosno (1913–1996) — 3D Gallery',
  titleMain:'Jan Kosno (1913–1996) — Gallery',
  brandSub:'1913–1996 · painting', navAbout:'About', navCollection:'Collection', nav3d:'3D Gallery',
  kicker:'Family collection · {n} works', heroLead:'Painter and draughtsman tied to the Kraków and Silesian art scene. <b>Paris of 1968–1970, Venice, the Tatras</b> — alongside impressions, abstractions and symbolic scenes. The entire legacy gathered in a virtual museum of nine rooms.',
  ctaEnter:'Enter the 3D gallery', ctaBrowse:'Browse the catalogue ↓',
  statWorks:'works', statRooms:'themed rooms', statParis:'Paris period',
  portraitCap:'<b>Self-portrait</b> · № 107 · oil on canvas',
  aboutH:'About the painter',
  bio1:'Jan Kosno painted for more than half a century — from pre-war suburban landscapes to the expressive impressions of the 1990s. Tied to the Kraków and Silesian art scene and to the ZPAP creative group “Postawy”, he left behind a coherent, recognisable painterly language: vibrant colour, trembling light and landscape on the edge of abstraction.',
  bio2:'At the turn of the 1960s and 70s he worked in Paris. That period produced series from the Seine and the Marché aux Puces, views of the city rooftops, and portraits of the Parisian bohème — hippies, musicians, booksellers.',
  bio3:'He painted Venice, the Tatras, Polish cities and the sea. In his mature work he reached ever more boldly for pure impression and symbol: burning mountain slopes, supernovae, stained glass of souls. The exhibition “Drawings and Paintings of Jan Kosno” was shown by Galeria Extravagance at Sielecki Castle in Sosnowiec (2002).',
  quote:'A painter of motion — of light that never stands still.', quoteSub:'on the art of Jan Kosno',
  bannerH:'Take a walk through the virtual museum',
  bannerP:'Nine rooms, paintings at their real scale, and the story of every work. On a computer: W A S D keys and mouse. On a phone: touch controls.',
  collectionH:'Collection', see3d:'View this room in 3D →', seeIn3d:'view in the 3D gallery →',
  footerL:'© The family of Jan Kosno · private collection', footerCat:'Catalogue',
  lbClose:'Close', lbPrev:'Previous', lbNext:'Next',
  introKicker:'Virtual gallery', introSub:'1913–1996 · {n} works · 9 themed rooms',
  howto:'How to explore',
  cWalkH:'Walking', cWalkP:'<b>W A S D</b> or arrow keys.<br><b>Shift</b> — run, <b>Space</b> — jump.',
  cLookH:'Looking', cLookP:'Click and move the mouse.<br><b>Q</b> / <b>E</b> — turn left / right.',
  cArtH:'Paintings', cArtP:'Look at a painting for details. Click or <b>N</b> — walk up & cycle works, <b>Esc</b> — back.',
  cRoomsH:'Rooms', cRoomsP:'Keys <b>1</b>–<b>9</b> or the list in the top-right corner.',
  tWalkH:'Walking', tWalkP:'Drag your finger on the <u>left</u> half of the screen — a joystick appears. Jump — the round button by the right edge.',
  tLookH:'Looking', tLookP:'Drag your finger on the <u>right</u> half of the screen.',
  tArtH:'Paintings & rooms', tArtP:'Tap a painting for details and a close-up. Pick rooms from the list at the top.',
  invertY:'Invert Y axis (mouse)', enter:'Enter the gallery', loading:'loading paintings…', ready:'ready',
  back:'← back to the main page', backTop:'← main page', brand3dSub:'1913–1996 · 3D gallery',
  hint:'Move: <b>W A S D</b> · turn: <b>Q E</b> · jump: <b>Space</b> · <b>N</b> — next painting · <b>click</b> = close-up',
  plaqueWorks:'works', lobbyLine:'PAINTINGS · {n} WORKS · 9 ROOMS',
  aboutPainter:'A B O U T   T H E   P A I N T E R',
  bioPanel1:'Painter and draughtsman, tied to the Kraków and Silesian art scene and to the ZPAP creative group “Postawy”.',
  bioPanel2:'At the turn of the 1960s and 70s he worked in Paris — creating series from the Seine, the Marché aux Puces and views of the city rooftops. He painted Venice, the Tatras, Polish cities and the sea; alongside landscapes he made impressions, abstractions and symbolic scenes.',
  bioPanel3:'The exhibition “Drawings and Paintings of Jan Kosno” was shown by Galeria Extravagance at Sielecki Castle in Sosnowiec (2002).',
  bioPanel4:'The collection holds {n} works in nine rooms.',
  selfPortrait:'JAN KOSNO · SELF-PORTRAIT',
  keyFound:'You found a little blue key…', secretOpen:'A secret passage has opened!',
  okeyFound:'You found an orange key… “Three Ladies” are waiting.',
  locked52:'Something is hidden here — but it needs a key.',
  secretRoom:'Secret room', secretHint:'Something creaked here — try jumping by the wall.',
  forestBack:'Touch the frame to return to the gallery', forestName:'Forest of the Three Ladies',
  consentText:'This site uses Google Analytics cookies to measure visits and for ad personalization and measurement. You can change your choice at any time in the page footer.',
  consentAccept:'Accept', consentDeny:'Essential only', privacy:'Privacy settings',
}};

export function makeT(lang){
  const d = STR[lang] || STR.pl;
  return (key, vars) => {
    let s = d[key] ?? STR.pl[key] ?? key;
    if(vars) for(const k in vars) s = s.replaceAll('{'+k+'}', vars[k]);
    return s;
  };
}
export const tGroup = (lang, g) => lang === 'en' ? (GROUPS_EN[g] || g) : g;
export const tCat   = (lang, c) => lang === 'en' ? (CATS_EN[c] || c) : c;
export const tSup   = (lang, s) => lang === 'en' ? (SUPPORTS_EN[s] || s) : s;
export const tTitle = (lang, it) => lang === 'en' ? (it.title_en || it.title) : it.title;
