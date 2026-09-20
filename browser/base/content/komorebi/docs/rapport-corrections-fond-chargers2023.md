# Corrections appliquées : fond "Chargers 2023 Anime" (workshopid 3703271055)

Fond de test : `C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3703271055/scene.pkg`,
extrait en JSON via `PackageReader` pour inspection numérique (aucune donnée du fond n'est codée en dur
dans les correctifs : ceux-ci sont génériques, vérifiés sur ce fond).

Convention Y déjà établie et VALIDÉE par `docs/trace-plein-ecran.md` (à ne pas re-discuter) :
`object.origin`/`transform.origin`/`uOrigin` sont en espace écran **Y-bas** (haut-gauche = origine,
Y augmente vers le bas), utilisés **directement**, sans conversion "centrée Y-up". C'est l'état actuel
du code (la tentative de conversion inverse a été testée puis annulée, cf. trace-plein-ecran.md) —
tous les calculs ci-dessous partent de ce fait, pas d'une hypothèse.

---

## Bug 1 — Double négation Y sur le mesh puppet ("Boy") — CORRIGÉ

### Preuve numérique (vertex réel du fichier `.mdl` de Boy)

Fichier : `models/u7myudkl99pmi7zryknn (1) (1)bgbgbgbgbg_sheet_puppet.mdl` (version `MDLV0023`,
1655 vertices, stride 80, uvOffset 72 — layout réellement sélectionné par `MdlParser.parse`,
vérifié en réimplémentant sa boucle de détection à l'identique dans un script Node séparé).

En lisant les floats **bruts** (avant toute négation), sur les 1655 vertices :
- Le vertex de **V minimal** (`v = 0.00089`, donc le plus proche du **haut** de la texture, puisque
  `TextureUploader` n'inverse jamais l'upload — ligne du haut de l'image = `v=0`, fait déjà établi
  dans `docs/rapport-coordonnees-orientation.md` §2.5 et confirmé par `trace-plein-ecran.md` étape D)
  a une position brute `Y = +917.99`.
- Le vertex de **V maximal** (`v = 1.0022`, donc le plus proche du **bas** de la texture) a une
  position brute `Y = -641.81`.

⇒ Le `Y` brut du fichier `.mdl` **augmente vers le haut de la texture** (convention Y-up), c'est un
fait mesuré sur ce fichier précis, pas une supposition sur le format `.mdl` en général.

### Chaîne actuelle (avant correctif)

- `MdlParser.ts:55` : `positions[i*2+1] = -raw` (1ʳᵉ négation, convertit Y-up fichier → une convention interne).
- `SceneLoader.ts:193` (avant correctif) : `positions[i+1] = -layer.puppet.positions[i+1] / height`
  (2ᵉ négation).
- Net : `positions[i+1] = -(-raw)/height = +raw/height` → **aucune négation nette**.

Convention locale attendue par `SceneVertexShader` (prouvée dans `trace-plein-ecran.md` étape E, avec
`QUAD_VERTICES`) : `aPosition.y = -0.5` (haut du quad local) → écran **haut**, `aPosition.y = +0.5` →
écran **bas**.

Avec la chaîne actuelle (aucune négation nette), un point avec `Y` brut `= +918` (proche du haut de la
texture, `v≈0`) donne `aPosition.y = +918/height` → **positif** → **bas** de l'écran (car positif =
bas dans la convention locale). Un point du haut de la texture se retrouve donc rendu en bas du mesh
(et réciproquement) : le personnage est **inversé haut/bas dans son propre repère local** — c'est
exactement le symptôme rapporté ("la tête est dans le mauvais sens").

### Correctif

`browser/base/content/komorebi/src/scene/SceneLoader.ts`, méthode `preparePuppet` : suppression de la
négation redondante (on garde uniquement celle de `MdlParser`, qui reste la seule conversion
"format fichier → convention interne") :

```ts
positions[index + 1] = layer.puppet.positions[index + 1] / height; // était : -layer.puppet.positions[...]
```

Avec le correctif : `Y=+918` → `aPosition.y = -918/height` (négatif) → **haut** de l'écran. Le point le
plus proche du haut de la texture (`v≈0`) se retrouve bien en haut du mesh local. Correct.

### `puppetEffectPositionBuffer` — divergence supplémentaire trouvée et corrigée

`preparePuppet` alimente aussi `effectPositions`, utilisée par `EffectRenderer` (première passe d'effet
sur un layer puppet, `EffectRenderer.ts:64-66`) en espace pixel **Y-bas** (0 = haut, `height` = bas —
prouvé par le quad de comparaison non-puppet `#prepareCopyPositionBuffer`/`FULLSCREEN_UVS`, où
pixel `y=0` est toujours apparié à `uv.y=0`, donc au haut de la texture).

Avant : `effectPositions[y] = height/2 - layer.puppet.positions[index+1]`.
En notant `P = layer.puppet.positions[index+1]` (sortie du parser, `P = -raw`), et en dérivant la
formule à partir de `aPosition.y` corrigé (`local_y = P/height`, avec `local_y=-0.5`→pixel `0`,
`local_y=+0.5`→pixel `height`, donc `pixel_y = height/2 + local_y*height = height/2 + P`) :
la formule correcte est `height/2 + P`, **pas** `height/2 - P`. L'ancienne formule avait donc le signe
opposé de celui requis pour rester cohérente avec `puppetPositionBuffer` — **avant même ce correctif**,
elle était déjà incohérente avec le buffer non-effet. Corrigée en même temps :

```ts
effectPositions[effectIndex + 1] = height / 2 + layer.puppet.positions[index + 1]; // était : height/2 - ...
```

(L'axe X n'a pas de bug : `positions[index] = puppet.positions[index]/width` et
`effectPositions[x] = width/2 + puppet.positions[index]` étaient déjà et restent corrects — pas de
négation appliquée nulle part sur X, cohérent avec le fait que `QUAD_VERTICES.x` n'a pas non plus
d'inversion de signe entre espace local et écran.)

**Fichier modifié :** `src/scene/SceneLoader.ts` (méthode `preparePuppet`).

---

## Bug 2 — `autosize` + `cropoffset` — REJETÉ APRÈS VÉRIFICATION (pas implémenté)

Hypothèse de départ (issue de la doc communautaire) : `cropoffset` = décalage à additionner à `origin`
pour compenser un recadrage automatique du sprite. Vérifiée par le calcul sur 3 couches indépendantes de
ce fond, et **infirmée**.

### Fait 1 — la texture n'est *jamais* plus petite que `object.size` déclaré

| Objet | `object.size` (scene.json) | Dimensions réelles du `.tex` référencé |
|---|---|---|
| Boy (361) | 3091×2240 | 3091×2240 |
| Jambe D (65) | 1073×685 | 1073×685 |
| Duck 3 (22, image `..._fg.json`) | 434×469 | 434×469 |
| Arbre (70, pas de `cropoffset`) | 3840×2160 | 3840×2160 |

Dans les 4 cas, la texture stockée fait **exactement** la taille déclarée par l'objet dans `scene.json`
— il n'y a donc, dans cet export, **aucune** texture "recadrée plus petite qu'annoncée" à compenser par
un décalage de repositionnement. `autosize` semble simplement signifier "la taille de la couche suit la
taille de la texture" (raison probable du nom), pas "la texture a été recadrée et il faut repositionner".

### Fait 2 — `origin - cropoffset` retombe exactement sur le centre du canevas, sur les 3 couches testées

`projection` de la scène = 3840×2160 (`general.orthogonalprojection`), donc centre = (1920, 1080).

| Objet | `origin` | `cropoffset` | `origin.x − cropoffset.x` | `origin.y − cropoffset.y` |
|---|---|---|---|---|
| Boy (361) | (1495.5, 1090) | (−424.5, 10) | **1920.0** | **1080.0** |
| Jambe D (65) | (1671.5, 769.5) | (−248.5, −310.5) | **1920.0** | **1080.0** |
| Duck 3 (22) | (723, 772.5) | (−1197, −307.5) | **1920.0** | **1080.0** |

Coïncidence exclue (3 couches indépendantes, valeurs décimales variées, résultat exact au centième près
sur les deux axes). Cela prouve mathématiquement que, dans cet export : `cropoffset = origin - (W/2, H/2)`
— `cropoffset` est **entièrement redondant** avec `origin` (probablement une métadonnée de ré-import PSD,
conservée par l'éditeur WE mais non nécessaire au rendu). `origin`, tel que déjà lu brut par
`SceneModel.localTransform`/`resolveLayerGeometry`, encode donc **déjà** la position finale correcte.

### Conséquence

Additionner `cropoffset` à `origin` (dans un sens ou dans l'autre) **compterait le décalage deux fois**
et dégraderait le positionnement au lieu de le corriger — testé par le calcul : pour Jambe D,
`origin + cropoffset` déplacerait la couche de 310px **vers le haut** (aggrave un éventuel "trop haut"
au lieu de le corriger), et l'amplitude pour Boy (+10px sur 2160, soit 0.46 %) est de toute façon trop
faible pour expliquer un symptôme visuellement significatif.

**Aucun code n'a été modifié pour ce point.** C'est cohérent avec le fait que `linux-wallpaperengine`
n'implémente pas non plus `cropoffset` (TODO explicite dans `CImage.cpp`) : au vu de cette preuve, ce
n'est probablement pas un manque fonctionnel mais un champ effectivement inutile au rendu, au moins pour
ce style d'export "autosize sans réduction de texture".

**Important :** cette preuve ne couvre que les exports où la texture égale `object.size` (observé ici
sur 4/4 couches). Si un fond futur montre un `.tex` réellement plus petit que `object.size` déclaré, la
question resterait ouverte et mériterait une nouvelle vérification numérique dédiée — ne pas généraliser
aveuglément ce rejet à ce cas non observé.

---

## Bug 3 — Orientation des particules ("Feuilles 1") — CORRIGÉ (bug général, pas spécifique aux feuilles)

`ParticleFragmentShader.ts` (avant correctif) :
```glsl
vec2 point = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5;
```

Fait vérifié (spécification WebGL — `gl_PointCoord`) : `gl_PointCoord.y = 0` correspond au **haut** du
point sprite tel que rasterisé à l'écran, `y = 1` au bas.

Fait déjà établi dans ce projet (upload textures sans `UNPACK_FLIP_Y_WEBGL`, ligne du haut de l'image
source = `v=0`, cf. `TextureUploader.ts` et `trace-plein-ecran.md` étape D) : pour être cohérent avec
tout le reste du pipeline (couches d'image), le **haut de ce qui est affiché à l'écran** doit échantillonner
`v=0` (haut de la texture source).

Avec la formule actuelle `1.0 - gl_PointCoord.y` : au sommet du sprite affiché (`gl_PointCoord.y=0`),
`point.y` avant rotation vaut `1 - 0 = 1` → après recentrage/rotation identité, on échantillonne au
niveau `top + height` du rect de texture, c'est-à-dire le **bas** du rect. Donc : haut-écran ↔ bas-texture,
bas-écran ↔ haut-texture — la texture de chaque particule est rendue **verticalement retournée**, de
façon systématique, pour **tout** système de particules (pas seulement `leaves1`) — cohérent avec le
symptôme "la feuille est dans le mauvais sens" observé sur ce fond, et généralisable à toute texture de
particule avec un haut/bas visuellement identifiable (icônes directionnelles, feuilles, flocons avec un
motif non symétrique, etc.).

### Correctif

`browser/base/content/komorebi/src/graphics/shaders/ParticleFragmentShader.ts` :
```glsl
vec2 point = vec2(gl_PointCoord.x, gl_PointCoord.y) - 0.5;   // suppression du "1.0 -"
```

Avec ce correctif, haut-écran (`gl_PointCoord.y=0`) échantillonne bien `v=0` (haut-texture), cohérent
avec la convention déjà utilisée pour les couches d'image dans ce même projet.

Note : cela ne change pas le **sens de rotation** perçu (la matrice de rotation 2D du fragment shader
reste inchangée) — un effet secondaire mineur possible est une inversion du sens apparent (horaire ↔
antihoraire) de la rotation par particule, indétectable visuellement pour une rotation aléatoire continue
sur un motif sans asymétrie de "sens de spin" marquée (cas des feuilles/pétales). Aucune preuve d'un bug
sur ce point précis, non traité ici faute de shader de référence WE consultable (limite déjà documentée
dans `docs/rapport-portage-particles.md` §0).

**Fichier modifié :** `src/graphics/shaders/ParticleFragmentShader.ts`.

---

## Bug 4 — "Boy parfois caché par le fond" (z-order) — REJETÉ, expliqué par le bug 1

Vérification du code de `SceneModel.createLayers()` (`src/scene/SceneModel.ts:130-164`) : les couches
sont ajoutées dans l'ordre de `scene.objects`, sauf réordonnancement par `dependencies` (les 4 objets
concernés — 70 Arbre, 65 Jambe D, 361 Boy, 49 Jambe G — n'ont **aucune** `dependencies`, vérifié
directement sur le JSON extrait).

Ordre réel dans `scene.objects` (indices du tableau) : `Arbre=6, Jambe D=7, Boy=8, Jambe G=9`. Donc
Arbre est ajouté et dessiné **avant** Boy → Boy dessine **au-dessus** d'Arbre dans le color buffer,
structurellement, quelle que soit sa position à l'écran.

Recherche exhaustive de toute logique de tri (`grep -rn "sort\|parallaxDepth\|parallax" src`) : le seul
`.sort(...)` du projet est dans `AnimatedProperty.ts:41`, sur des keyframes d'animation, sans rapport
avec l'ordre de rendu des couches. `parallaxDepth`/`parallax` n'apparaît **nulle part** dans `src` — il
n'influence donc bien l'ordre de rendu nulle part (ni ailleurs).

**Conclusion :** aucun bug de z-order n'existe dans le code. Le symptôme "Boy parfois caché" s'explique
entièrement par le bug 1 (mesh puppet retourné/mal formé avant correctif — un mesh dont les triangles
sont mal orientés dans son propre repère peut produire des zones visuellement incohérentes qui donnent
l'impression que le personnage "disparaît" par endroits). Aucun correctif de z-order n'a été fabriqué ;
conformément à la consigne, ce point est documenté comme expliqué par le bug 1 plutôt que masqué par un
faux correctif.

---

## Récapitulatif

| # | Bug | Statut | Fichier(s) modifié(s) |
|---|---|---|---|
| 1 | Double négation Y du mesh puppet (position + effect-position) | **Corrigé** | `src/scene/SceneLoader.ts` |
| 2 | `autosize`/`cropoffset` non géré | **Rejeté après vérification** (redondant avec `origin`, preuve exacte sur 3 couches) | aucun |
| 3 | Orientation verticale des particules | **Corrigé** (bug général, tous systèmes de particules) | `src/graphics/shaders/ParticleFragmentShader.ts` |
| 4 | Z-order "Boy caché" | **Rejeté** — pas de bug de z-order ; expliqué par le bug 1 | aucun |

## Compilation

`npx tsc -p src/tsconfig.build.json` (depuis `browser/base/content/komorebi`) : **succès, aucune erreur**.
`dist/scene/SceneLoader.js` et `dist/graphics/shaders/ParticleFragmentShader.js` contiennent bien les
correctifs (vérifié par grep post-compilation).

## Limite connue, non traitée dans cette passe : animation de bones (`animationlayers`)

Confirmé sur ce fond : l'objet Boy (id 361) référence `animationlayers` avec deux entrées
(`animation: 326`, `animation: 398`, blend additif). Recherche dans `src` : `grep -rn "animationlayers"
src --include=*.ts` ne retourne **aucun** résultat — ce champ n'est lu nulle part côté Komorebi.
`MdlParser.ts` n'extrait qu'un unique bloc de mesh statique (positions/UV/indices, jusqu'au marqueur
`MDLS`) : aucune structure d'os/squelette n'est parsée. Côté référence, `linux-wallpaperengine`
n'implémente pas non plus le rendu de puppet mesh du tout (cf. contexte de la tâche : `CImage.cpp`
n'utilise jamais le champ `puppet`), donc il n'y a pas non plus de référence C++ à porter pour
l'animation de bones.

**Conséquence pour l'utilisateur :** même avec les correctifs ci-dessus, "Boy" restera figé dans sa pose
de repos statique telle qu'enregistrée dans le fichier `.mdl` — aucune animation de marche/mouvement des
membres ne sera rejouée.

**Estimation qualitative d'effort pour une implémentation future** (non réalisée ici) : élevée. Il
faudrait (1) reverse-engineer/documenter le format binaire `.anim` référencé par `animation: 326/398`
(actuellement non parsé du tout dans ce projet, aucun `AnimParser` n'existe), (2) étendre `MdlParser`
pour extraire les données de squelette/poids de peau (bone weights) si elles sont présentes ailleurs
dans le fichier `.mdl` au-delà du bloc de mesh actuellement lu (zone non explorée dans cette passe —
seul le bloc jusqu'à `MDLS` a été analysé), (3) implémenter l'échantillonnage de keyframes + skinning
(déformation du maillage par les os pondérés) par frame dans `SceneLoader`/`LayerRenderer`, (4) gérer le
blending additif entre plusieurs `animationlayers` simultanées. C'est un chantier comparable en ampleur
au système de particules ou d'effets déjà portés, à traiter dans une passe dédiée.

## Prochaine étape

Recharger ce fond précis (workshopid 3703271055, "Chargers 2023 Anime") dans le navigateur avec le
`dist/` recompilé, et vérifier visuellement : orientation de la tête et proportions générales de "Boy"
(bug 1), sens des feuilles animées "Feuilles 1" (bug 3), et confirmer que les canards/jambes restent
correctement positionnés (aucun changement de position n'a été apporté pour eux dans cette passe, bug 2
étant rejeté — si leur position reste visuellement "trop haute" après ce rechargement, cela indique une
cause encore non identifiée, à ré-investiguer séparément plutôt que de raccrocher au bug 2 déjà infirmé).
