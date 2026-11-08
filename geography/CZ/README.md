# Slepá mapa ČR

Interaktivní slepá mapa České republiky pro výuku zeměpisu. Žáci poznávají a zařazují
řeky, hory, vrcholy, města, kraje a vodní plochy. Učitel si může nahrát vlastní seznam
míst z Excelu.

Aplikace je čistě statická webová stránka – nepotřebuje server ani instalaci.
Stačí otevřít `index.html` v prohlížeči (funguje i offline), nebo ji zveřejnit např.
přes GitHub Pages.

## Režimy

| Režim | Co dělá žák |
|---|---|
| **Atlas** | Prohlíží mapu s popisky. Po vypnutí „popisky“ funguje jako slepá mapa, kde se název ukáže po najetí myší. |
| **Přiřazování** | Přetahuje názvy ze seznamu na očíslovaná místa v mapě (na tabletu: ťuknout na název a pak na číslo). Pak klikne na *Zkontrolovat*. |
| **Najdi na mapě** | Aplikace řekne název, žák klikne do mapy. Lehká obtížnost = vybírá ze značek, těžší = bez značek, vyhodnocuje se vzdálenost v km. |
| **Poznej místo** | V mapě se zvýrazní místo / řeka / kraj, žák vybírá ze 4 možností. |
| **Ve kterém kraji?** | V mapě je vyznačeno město, hrad či vrchol, žák klikne na kraj, ve kterém leží. |
| **Data** | Nahrání tabulky z Excelu, stažení vzoru, export, přidání místa kliknutím do mapy, odkaz pro žáky. |

Nahoře se vybírají **sekce** (Řeky, Hory, Vrcholy, Města, Kraje, Vodní plochy, Hrady a zámky,
Národní parky a CHKO a jakékoli vlastní kategorie z tabulky – např. Národní parky, Památky UNESCO, Rozhledny). Na konci každého kola se zobrazí počet bodů, procenta a známka
(90 % → 1, 75 % → 2, 50 % → 3, 30 % → 4) a lze opakovat jen chybné odpovědi.

Mapu lze přibližovat kolečkem myši nebo tlačítky +/− a posouvat tažením.

V **Atlasu** se po kliknutí na místo zobrazí podrobnosti a souvislosti: u města či hradu kraj,
u řeky kraje, kterými protéká, u kraje všechna místa z dat, která v něm leží (např. všechny
hrady v kraji). Každé místo má odkaz *Zobrazit na Mapy.cz* – hodí se i ke kontrole polohy.

## Tabulka z Excelu

Vzorová tabulka: [`priklady/slepa-mapa-vzor.xlsx`](priklady/slepa-mapa-vzor.xlsx)
(nebo tlačítko *Stáhnout vzorovou tabulku* v režimu Data).

| Název | Kategorie | Zeměpisná šířka | Zeměpisná délka | Poznámka |
|---|---|---|---|---|
| Brno | Města | 49.1951 | 16.6068 | |
| Sněžka | Vrcholy | 50.736 | 15.740 | 1603 m |
| Vltava | Řeky | | | |
| Jihomoravský kraj | Kraje | | | |
| Karlštejn | Hrady a zámky | 49.9393 | 14.1882 | gotický hrad |

- Nepovinné sloupce: **Kraj** (přebije kraj vypočtený z mapy – vhodné pro místa těsně u hranice
  krajů) a **Odkaz** (webová adresa, zobrazí se po odpovědi, např. stránky hradu).
- **Kategorie** = sekce v aplikaci. Může být libovolná (např. *Hrady*, *UNESCO*, *Národní parky*).
- **Souřadnice** stačí desetinné (`49.1951` i `49,1951`), fungují i stupně (`49°11′42″`).
  Místo dvou sloupců může být jeden sloupec *Souřadnice* ve tvaru z mapy.cz (`49.1951N, 16.6068E`).
  Souřadnice zjistíte na [mapy.cz](https://mapy.cz) – pravé tlačítko → *Co je zde?*.
- **Řeky a kraje** nepotřebují souřadnice, jejich tvar je v mapě a páruje se podle názvu
  (u krajů stačí i „Jihomoravský“ nebo „Vysočina“).
  Dostupné řeky: Vltava, Labe, Morava, Odra, Ohře, Dyje, Berounka, Sázava, Jizera, Otava,
  Lužnice, Svratka, Svitava, Jihlava, Opava, Bečva, Ostravice, Malše, Orlice, Lužická Nisa,
  Mže, Radbuza, Úhlava, Ploučnice.
- **Národní parky a CHKO** také nepotřebují souřadnice (kategorie např. *Národní parky a CHKO*,
  názvy jako „NP Šumava“, „CHKO Křivoklátsko“, „Národní park Podyjí“).
- Podporované formáty: `.xlsx`, `.xls`, `.ods`, `.csv` (oddělovač `;`, `,` nebo tabulátor).
- Řádky, které nejde umístit (chybí souřadnice, místo mimo ČR, neznámá řeka), aplikace
  přeskočí a vypíše, na kterém řádku je problém.

Nahraná data se ukládají v prohlížeči (localStorage), takže po zavření stránky zůstanou.
Každý počítač/prohlížeč má svá data. Pro třídu použijte tlačítko **Zkopírovat odkaz pro žáky**:
odkaz obsahuje celou sadu míst (zakódovanou v adrese), takže žákům stačí odkaz otevřít.
(Funguje, když je aplikace zveřejněná na webu, např. přes GitHub Pages.)

## Správnost dat

Souřadnice míst byly ověřeny proti **Wikidatům** (města, vrcholy, hrady a zámky – odchylka do 1 km,
většinou pod 200 m) a body vodních nádrží leží na hladině podle DIBAVOD. Body pohoří jsou jen
orientační (pohoří je plocha; geomorfologické členění ČGS není veřejně dostupné).

Kontrola `node tools/overit-data.js` (bez internetu) ověřuje, že:

- každé město, vrchol, nádrž a hrad leží v ČR a ve správném kraji,
- řeky protékají městy, kterými mají (např. Otava – Sušice, Strakonice, Písek), a ústí do správné řeky,
- body nádrží leží ve vodní ploše.

Body ležící přímo na hranici (Sněžka na státní hranici, Pernštejn u hranice krajů) mají kraj
uveden výslovně ve sloupci *kraj*.

## Struktura projektu

```
index.html            stránka aplikace
css/style.css         vzhled
js/app.js             logika (mapa, režimy, import/export)
data/places.js        výchozí sada míst
data/geo.js           mapové podklady (vygenerováno, needitovat ručně)
tools/build-geo.js    skript, který vytváří data/geo.js
tools/overit-data.js  kontrola správnosti dat
tools/dibavod.js      převod dat DIBAVOD (Shapefile, S-JTSK) na GeoJSON
vendor/               knihovna SheetJS pro čtení/zápis Excelu (Apache 2.0)
priklady/             vzorová tabulka
```

### Mapové podklady

| Vrstva | Zdroj |
|---|---|
| Hranice krajů a státu | **ČÚZK** – INSPIRE Územní správní jednotky (přes [siwekm/czech-geojson](https://github.com/siwekm/czech-geojson), `kraje.json`) |
| Řeky a vodní nádrže | **DIBAVOD** – VÚV T. G. Masaryka, vrstvy A02 Vodní tok a A05 Vodní nádrže ([dibavod.cz](https://www.dibavod.cz/27/struktura-dibavod.html)) |
| Národní parky a CHKO | **Česká geologická služba** – mapová služba `Popularizace/chranena_uzemi`, vrstva Velkoplošná (CHKO Beskydy a Moravský kras v ní chybí) |
| Okolní státy | [Natural Earth](https://www.naturalearthdata.com/) (volné dílo) |

Vše je zjednodušené pro měřítko mapy (~100–200 m), sousední kraje sdílejí stejnou hranici.
Pokud některý zdroj chybí, `build-geo.js` použije záložní data z Natural Earth.

Přegenerování `data/geo.js`:

```
# 1) Natural Earth GeoJSON (ne_10m_admin_0_countries, ne_10m_admin_1_states_provinces,
#    ne_10m_rivers_lake_centerlines, ne_10m_rivers_europe, ne_10m_lakes_europe)
#    z https://github.com/nvkelso/natural-earth-vector/tree/master/geojson do složky geo/
# 2) kraje.json ze siwekm/czech-geojson uložit jako geo/cuzk-kraje.json
# 3) DIBAVOD: stáhnout a rozbalit dib_A02_Vodni_tok_JU.zip a dib_A05_Vodni_nadrze.zip do dib/
node tools/dibavod.js dib geo          # → geo/dibavod-reky.geojson, geo/dibavod-nadrze.geojson
# 4) CHKO a NP z ČGS:
curl -o geo/cgs-vcu.geojson "https://mapy.geology.cz/arcgis/rest/services/Popularizace/chranena_uzemi/MapServer/2/query?where=1%3D1&outFields=kat,nazev&outSR=4326&maxAllowableOffset=0.0015&geometryPrecision=5&f=geojson"
node tools/build-geo.js geo
node tools/overit-data.js              # kontrola
```

## Zveřejnění na GitHub Pages

V nastavení repozitáře: *Settings → Pages → Deploy from a branch* → vybrat větev a složku `/ (root)`.
