# Lacunes connues (fonctionnalités non implémentées, pas des bugs)

Suivi des fonctionnalités Wallpaper Engine volontairement désactivées ou non
portées, pour ne pas les perdre de vue au fil des sessions de correction.
Contrairement aux `rapport-*.md` (analyse de bugs de rendu ponctuels), ce
fichier liste des trous d'architecture assumés.

## Réactivité audio (combo `AUDIOPROCESSING`)

**Statut** : désactivé de force (`ShaderParser.ts`, `#discoverCombos` — le
combo `AUDIOPROCESSING` est toujours ramené à `0`, quelle que soit la
configuration du fond).

**Pourquoi ce n'est pas juste un bug shader** : `AUDIOPROCESSING` pilote un
effet (ex. `effects/pulse`) qui réagit au son du système (n'importe quelle
appli, pas seulement l'onglet actif) via une analyse spectrale 16 bandes
(`g_AudioSpectrum16Left/Right`). Komorebi n'a aujourd'hui aucun pipeline de
capture/FFT audio (`grep -r "AudioSpectrum\|FFT\|spectrum" src` ne trouve
rien). Laisser le combo activé sans données réelles derrière produirait un
effet figé/aléatoire, et sa branche `#if AUDIOPROCESSING` utilise en plus une
boucle `for` bornée par une valeur uniform (non constante), que GLSL ES 1.00
(WebGL1) refuse purement et simplement à la compilation — contrairement à
HLSL (langage d'origine des shaders WE) qui l'autorise.

**Pour le faire vraiment** : il faudrait (1) confirmer que du code chrome
Firefox peut capturer l'audio *système* (pas seulement le contenu d'une page
via Web Audio standard — capturer ce qui joue dans une appli tierce comme
Spotify demande une API bien plus privilégiée, à vérifier), (2) faire une
analyse spectrale en continu, (3) pousser 16 bandes gauche/droite par frame
dans les uniforms shader. Décision prise le 2026-08-16 : reporté, priorité
donnée aux bugs de rendu qui bloquent l'affichage sur beaucoup plus de fonds.

## Animation squelettique des personnages puppet-warp (`animationlayers`)

**Statut** : non implémenté. `MdlParser.ts` extrait uniquement le mesh
statique (pose de repos) d'un fichier `.mdl` ; les `animationlayers` déclarés
sur l'objet scène (référençant des animations par id, ex. `"animation": 326`)
ne sont jamais lus ni appliqués.

**Impact concret observé** : sur le fond "Chargers 2023 Anime"
(workshopid 3703271055), le personnage "Boy" reste figé dans sa pose de
repos du fichier `.mdl` — voir `rapport-corrections-fond-chargers2023.md`.

**Pourquoi ce n'est pas fait** : ni Komorebi ni la référence
`linux-wallpaperengine` n'implémentent le rendu de bones/squelette pour les
meshes puppet-warp — aucun code de référence à porter. Nécessiterait de
parser les fichiers `.anim` référencés et d'appliquer des transformations de
bones par frame, une fonctionnalité entièrement nouvelle. Effort non estimé
précisément, probablement significatif (nouveau parser de format binaire +
nouveau système d'interpolation d'animation + intégration dans le pipeline
de rendu du mesh puppet).

## Fonds de type "web" et "application" (message "type de fond non pris en charge")

**Statut** : non implémenté, volontairement. Wallpaper Engine a 4 types de projet :
`scene` (rendu WebGL natif), `video`, `web` (page HTML/CSS/JS), `application`
(programme natif `.exe` lancé en fond). Komorebi ne gère que `scene` et
`video` — voir `komorebi-library.js` (`readProject`, champ `supported` :
`sceneSupported || (videoSupported && Boolean(filePath))`, aucune branche
pour `"web"`/`"application"`). `komorebi-web-renderer.js` existe déjà comme
point d'ancrage mais est un stub vide (`get supported() { return false; }`),
jamais branché sur la détection de `readProject`.

**Pourquoi ce n'est pas un bug à corriger** : contrairement aux erreurs de
compilation shader (bugs de portage), un fond `web` demanderait de construire
un nouveau moteur de rendu (une iframe/browsing context sandboxé chargeant
la page HTML du fond) et un fond `application` demanderait de lancer un
exécutable Windows arbitraire depuis le sélecteur de fonds d'écran — ce
dernier soulève une vraie question de sécurité (exécution de code natif non
sandboxé fourni par un fond Workshop tiers), à trancher avant d'envisager de
l'implémenter.

**Décision** : reporté par défaut, même raisonnement que la réactivité audio
— fonctionnalité entièrement nouvelle, pas un correctif. À prioriser si
l'utilisateur a des fonds `web`/`application` spécifiques qu'il veut voir
fonctionner.

## Effets utilisant des fonctionnalités GLSL ES 3.00 (Komorebi tourne en WebGL1)

**Statut** : non supporté, plafond d'architecture. `GraphicsContext.gl` est
typé `WebGLRenderingContext` (WebGL1 / GLSL ES 1.00) partout dans
`src/graphics/`. Certains effets Wallpaper Engine plus récents/complexes
utilisent des fonctionnalités qui n'existent qu'en GLSL ES 3.00 (WebGL2) :
tableaux avec initialiseur (`vec2[22] arr = vec2[](...)`), affectation de
tableau entier, opérateur `%` (modulo entier), type `uint`. Exemples
observés concrètement : `bokeh_blur` (workshop/2798319181, tableau
`vec2[22]`), `Simple_Audio_Bars` (workshop/2084198056, tableaux `float[32]`,
`%`, `uint`).

**Pourquoi ce n'est pas un correctif de transpileur** : contrairement aux
divergences HLSL→GLSL ES 1.00 déjà corrigées cette session (mélange
int/float, troncature de vecteur, ordre des arguments...), il n'existe
aucune syntaxe GLSL ES 1.00 équivalente à un tableau avec initialiseur ou à
l'opérateur `%` — ce sont des fonctionnalités absentes du langage cible, pas
juste une différence de forme.

**Ce qu'il faudrait pour corriger ça** : migrer le contexte de rendu vers
WebGL2 (`WebGLRenderingContext` → `WebGL2RenderingContext`, GLSL ES 1.00 →
3.00 dans `ShaderParser`/`ShaderCompiler`), un changement d'architecture qui
toucherait tout `src/graphics/` et demanderait de revalider l'ensemble des
effets déjà corrigés. Décision à prendre par l'utilisateur avant de s'y
lancer — hors périmètre de cette passe de correction shader par shader.

## Calques inversés verticalement sur certains fonds à effets (non résolu, pas une lacune assumée)

**Statut** : bug non résolu, pas encore root-causé — contrairement aux autres
entrées de ce fichier, ce n'est PAS une fonctionnalité volontairement
reportée. Consigné ici pour ne pas reperdre le fil de session en session.

**Symptôme** : sur certains fonds, un ou plusieurs calques image apparaissent
retournés verticalement (personnage tête en bas, paysage avec le ciel en
bas), alors que d'autres éléments du même fond (particules) restent corrects.
Confirmé par capture d'écran sur `2364332279` (avant correctif) et
`1851524277` (calques `bg0`/`island1-3` inversés, particules "pétales"
correctement orientées).

**Fonds confirmés inversés** (capture ou description utilisateur) :
`1519783946`, `2364332279`, `2182864111`, `1851524277`, `2111201226`,
`2499859642`. Fonds où l'inversion a semblé disparaître après un correctif
depuis annulé : `1519783946`, `2364332279`, `2382718309`, `2482408967`.

**Piste explorée** : un correctif dans `Matrix4.orthographic()`/
`inverseOrthographic()` (flip du signe de la ligne Y, pour faire correspondre
la matrice utilisée par la 1re passe d'`EffectRenderer` — copy-buffer non-
puppet ou `puppetEffectPositionBuffer` — à la convention Y-vers-le-bas
documentée dans `SceneLoader.preparePuppet()`) corrige 4 fonds
(`1519783946`, `2364332279`, `2382718309`, `2482408967`) mais en casse 3
autres qui étaient corrects avant (`1851524277`, `2111201226`,
`2499859642`). **Actuellement APPLIQUÉ** (net positif mesuré : 4 corrigés
contre 3 régressés), faute de mieux — voir ci-dessous pourquoi une
correction ciblée n'a pas été possible.

Un diagnostic runtime (log dans `EffectRenderer.run()`, toujours en place)
comparant un fond du groupe "corrigé" (`2382718309`/`2482408967`) et un du
groupe "régressé" (`1851524277`) n'a trouvé AUCUNE différence sur les
propriétés observables sans lire les pixels réels : les deux groupes ont
`hasMVP=true` (vrai shader d'effet WE, pas le passthrough interne
`commands/copy`), `usesPuppetBuffer=false`, `aPositionLocation=0`. Aucun
facteur structurel commun trouvé non plus dans les données statiques
(shaders `waterwaves`/`shake` des deux côtés, nombre de passes non corrélé,
format de texture PNG/JPEG non corrélé, particules non corrélées).

**Hypothèse non vérifiée** : le mélange, sur un même fond (`1851524277`), d'un
vrai flip d'orientation ET d'un bug de positionnement/dimensionnement de
calque indépendant (rectangle fantôme mal placé, voir capture) suggère que
plusieurs bugs distincts se superposent plutôt qu'une cause unique.

**Mise à jour** : diagnostic poussé bien plus loin, avec des faits mesurés
(pas des suppositions) :
- Un log runtime (`gl.readPixels`, toujours en place dans
  `RenderPipeline.render()`) comparé à une lecture directe des pixels sources
  (décodage PNG hors-ligne) **prouve numériquement** que `1519783946` est
  correct et `1851524277` (calque `bg0`) est inversé, avec le correctif
  `Matrix4` actif — confirmé une troisième fois par les images `preview.gif`/
  `preview.jpg` officielles fournies par Wallpaper Engine sur le Workshop
  (aperçu généré par WE lui-même, donc référence de vérité). Ce n'est plus
  une question de perception : l'asymétrie est réelle et mesurée.
- Lecture complète (pas des extraits) de `CPass.cpp` (1114 lignes) et des
  fonctions clés de `CImage.cpp` (`uploadGeometryBuffers`,
  `resolveGeometrySize`, `updateScenePosition`, `render()`,
  `configurePassTarget`) : **aucune logique conditionnelle** n'y distingue un
  fond d'un autre — même passe de copie, même matrice nonflippée, pour tous
  les fonds, tout le temps. Donc le moteur de référence ne "sait" pas non
  plus quel fond a besoin de quoi ; il produit le bon résultat pour tous via
  un seul chemin de code.
- Comparaison binaire complète des en-têtes `.tex` de `947820.tex`
  (1519783946) et `bg0.tex` (1851524277) : structure identique (mêmes
  drapeaux, format PNG, nombre de mipmaps comparable, pas de padding NPOT
  pour aucun des deux).
- Bug **réel et distinct** trouvé au passage et corrigé : `EffectRenderer`
  utilisait un UV 0..1 codé en dur pour la 1re passe, ignorant
  `layer.u`/`layer.v` (fraction valide d'une texture paddée NPOT — voir
  `CImage::uploadGeometryBuffers`). `island1`/`island2`/`island3` (dans
  `1851524277`) ont ce padding (ex. 648×637 réel dans un conteneur
  1024×1024) ; corrigé via `#prepareCopyTexCoordBuffer(layer.u, layer.v)`.
  Sans rapport avec l'asymétrie de flip elle-même (`bg0`/`947820` n'ont pas
  de padding).

**Conclusion honnête** : investigation exhaustive (code Komorebi, code de
référence C++ complet sur ce chemin, données binaires sources) sans trouver
le facteur distinctif. Suspicion non vérifiée : bug d'état GPU/exécution
(ordre de compilation de programme, cache de shader, comportement WebGL
spécifique à Firefox/ANGLE) invisible à l'inspection statique — nécessiterait
soit un débogueur GPU en direct (bloqué ici : `headless-gl` ne compile pas,
`node-gyp` ne reconnaît pas la VS installée), soit de faire tourner
`linux-wallpaperengine` en parallèle pour comparer frame par frame. Le
correctif `Matrix4` a finalement été **annulé** (retour à la forme non
flippée d'origine) : un correctif qui échange un jeu de bugs contre un autre,
sans cause racine identifiée, n'est pas un net positif défendable sur le
long terme. `1519783946`/`2364332279`/`2382718309`/`2482408967` sont donc de
nouveau inversés en l'état ; à reprendre avec un débogueur GPU en direct ou
`linux-wallpaperengine` en parallèle avant de retenter quoi que ce soit ici.

## Projection caméra automatique et parallaxe caméra

**Statut** : non implémenté. Voir `rapport-coordonnees-orientation.md`
(D6/D7). `CScene.cpp` calcule la taille de projection depuis les extents des
objets en mode auto ; Komorebi lit toujours `orthogonalprojection` fourni
par la scène. La parallaxe pilotée par la souris (`camera.parallax`) n'a pas
d'équivalent dans `LayerRenderer`/`SceneVertexShader`.

**Impact** : fonds utilisant ces réglages caméra spécifiques auront un
cadrage ou un comportement de parallaxe différent de la référence. Non
prioritaire tant que des fonds avec ces réglages ne sont pas identifiés
concrètement comme cassés.
