# Bibliothèque shader standard manquante : fetch des vrais fichiers WE

Fichiers modifiés :
- `komorebi-library.js` (`findWallpaperEngineAssetRoot`)
- `src/scene/SceneLoader.ts` (`loadExternalTextures`, nouveau `loadExternalShaders`,
  nouveau `collectShaderNames`, appel dans `load()`)
- `src/parser/ShaderIncludes.ts` (nouveau, regex `#include` partagée)
- `src/parser/ShaderParser.ts` (réutilise `SHADER_INCLUDE_PATTERN`, commentaire
  clarifiant que `#standardInclude` est désormais un filet de sécurité)
- `dist/**` régénéré par `npx tsc -p src/tsconfig.build.json` (aucune erreur)

==================================================================
## FAIT PROUVÉ — la cause exacte du bug, avec le fond de test réel
==================================================================

Wallpaper de test : `.../workshop/content/431960/3703271055/scene.pkg`. Son
`.pkg` embarque `shaders/workshop/3424038533/effects/blur_precise_gaussian.frag`,
dont le contenu réel est :

```glsl
#include "common_blur.h"
...
#if KERNEL == 2
  vec4 albedo = blur3a(v_TexCoord.xy, v_TexCoord.zw);
#endif
```

`common_blur.h` — qui définit `blur3a` — n'est PAS dans `pkg.entries` (vérifié :
`pkg.entries.has("shaders/common_blur.h")` → `false` avant le fix). Avant ce
correctif, `ShaderParser.#standardInclude("common_blur.h")` retournait `""` (ce
nom n'était pas dans la liste des 3 fichiers réimplémentés à la main), donc
`#include "common_blur.h"` disparaissait silencieusement et `blur3a` restait
non défini au moment de sa compilation GLSL → exactement l'erreur console
rapportée par l'utilisateur (`'blur3a' : no matching overloaded function found`).

Ceci n'est pas spécifique à ce fond : n'importe quel effet stock Wallpaper
Engine qui compte sur `common_blur.h`, `common_fog.h`, `common_foliage.h`,
`common_pbr.h`, `common_pbr_2.h`, `common_perspective.h`, `common_vertex.h`,
ou sur les parties de `common.h`/`common_blending.h`/`common_composite.h`
qui n'étaient pas réimplémentées, tombe dans le même trou.

==================================================================
## Le fix : réutiliser (et étendre) le mécanisme de fetch existant
==================================================================

Le mécanisme qui allait déjà chercher les `.tex` manquants dans l'installation
Wallpaper Engine locale (`findWallpaperEngineAssetRoot` → `assetRoot` →
`SceneLoader.loadExternalTextures`) a été étendu, pas réinventé :

1. **`komorebi-library.js`** : `findWallpaperEngineAssetRoot` pointait vers
   `steamapps/common/wallpaper_engine/assets/materials/`. Il pointe maintenant
   vers `assets/` (parent commun de `materials/`, `shaders/`, `effects/`),
   avec la vérification d'existence sur ce dossier `assets/` au lieu de
   `materials/`. Vérifié : `assetRoot` n'est utilisé qu'à deux endroits
   (`SceneLoader.loadExternalTextures` et le nouveau `loadExternalShaders`),
   tous deux dans ce changement — pas d'autre consommateur externe de la
   sémantique `materials/`.

2. **`SceneLoader.loadExternalTextures`** : ajuste l'URL construite pour
   inclure le segment `materials/` explicitement (`materials/${name}.tex`
   au lieu de `${name}.tex`), pour rester cohérent avec le nouveau sens
   d'`assetRoot`.

3. **`SceneLoader.loadExternalShaders`** (nouveau, appelé dans `load()`
   juste après `loadExternalTextures`, donc AVANT `new SceneModel(pkg)` /
   `createLayers()` / la compilation GLSL synchrone) :
   - Collecte tous les noms de shader référencés par les JSON du `.pkg`
     (clé `"shader"` dans les passes de matériau, via `collectShaderNames`,
     même schéma que `collectTextureNames` pour les textures) et ajoute
     `shaders/${name}.vert` / `.frag` à une liste de travail.
   - Ajoute aussi tous les fichiers déjà présents sous `shaders/` dans le
     `.pkg` à cette même liste (leurs `#include` doivent être résolus même
     si le fichier `.vert`/`.frag` lui-même est déjà embarqué — c'est le cas
     dominant en pratique, voir plus bas).
   - Traite la liste en largeur : pour chaque chemin, s'il est absent de
     `pkg.entries`, le fetch depuis `assetRoot` (`shaders/<reste-du-chemin>`)
     via `fetchPackage`/`toFileURI`, comme pour les textures ; puis, que le
     contenu vienne du `.pkg` ou du fetch, en extrait les directives
     `#include` (regex partagée `SHADER_INCLUDE_PATTERN`, factorisée dans
     `src/parser/ShaderIncludes.ts` et réutilisée telle quelle par
     `ShaderParser#resolveIncludes`) et ajoute chaque nom inclus
     (`shaders/${name}`) à la liste de travail. Boucle jusqu'à stabilisation
     (`visited` Set), donc gère la récursivité (`common_blending.h` qui
     inclut `common.h`, etc.).
   - Résultat : au moment où `MaterialParser`/`ShaderParser.compile()`
     tournent (synchrones, lisent uniquement `#entries`), tous les fichiers
     `.h` référencés sont déjà dans `pkg.entries` sous la clé
     `shaders/<nom>`, exactement la clé que `#resolveIncludes` teste en
     premier (`candidates = ["shaders/" + name, name]`).

4. **`ShaderParser.#standardInclude`** : conservé tel quel (n'est plus
   supposé être atteint pour un fond correctement résolu), avec un
   commentaire explicite indiquant que c'est un filet de sécurité dégradé
   pour le cas sans installation Wallpaper Engine locale (`assetRoot` nul)
   ou pour un header que cette approximation ne connaît pas. Le fix de
   duplication déjà en place (`stack` non libéré après expansion, cf.
   commentaire existant sur `#resolveIncludes`) n'a pas été touché.

==================================================================
## Test de vérification réel (hors contexte chrome Firefox)
==================================================================

Script Node (`dist/` compilé, pas de source TS interprétée directement),
`assetRoot` simulé avec un polyfill minimal de `XMLHttpRequest` pour les
URLs `file://` (lit le fichier avec `fs.readFileSync`, imite l'interface que
`SceneLoader.fetchPackage` attend) :

```
assetRoot = "file:///C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/assets/"
pkg = PackageReader.parse(scene.pkg, "scene.json")

AVANT loadExternalShaders :
  pkg.entries.has("shaders/common_blur.h") -> false
  pkg.entries.has("shaders/workshop/3424038533/effects/blur_precise_gaussian.frag") -> true (déjà dans le .pkg)

new SceneLoader(null).loadExternalShaders(pkg, assetRoot)

APRÈS :
  pkg.entries.has("shaders/common_blur.h") -> true
  contenu de shaders/common_blur.h contient "blur3a" -> true

new ShaderParser(pkg.entries).compile(
  "workshop/3424038533/effects/blur_precise_gaussian", "frag",
  { KERNEL: 2, MASK: 0, BLURALPHA: 1, ENABLEMASK: 0 }, new Map()
)
  -> le GLSL généré contient "vec4 blur3a(...)" (la définition, injectée par
     l'include résolu) AVANT l'appel "blur3a(v_TexCoord..." dans main() ->
     confirmé que le compilateur GLSL recevrait désormais une fonction
     définie, plus l'appel à une fonction inconnue.
```

`loadExternalTextures` a aussi été re-testé après le changement de sémantique
d'`assetRoot` (`materials/` explicite dans l'URL construite) : sur ce même
`.pkg`, une texture externe manquante est bien récupérée depuis
`assetRoot + "materials/<nom>.tex"` (94 entrées après contre 93 avant, la
texture attendue apparaît dans `pkg.entries`).

Limitation honnête : ce test valide le mécanisme de fetch et la sortie de
`ShaderParser.compile()` en dehors du navigateur (Node avec un polyfill
`XMLHttpRequest`/`file://` minimal, sans `IOUtils`/`PathUtils` réels de
Firefox — ceux-ci ne sont pas mockés ici, seul `findWallpaperEngineAssetRoot`
dans `komorebi-library.js` en dépend et n'a pas pu être exécuté directement
dans ce test). Il ne remplace pas un rendu WebGL réel : il ne prouve pas que
le GLSL généré compile et link sans erreur dans un vrai contexte WebGL, ni
que le rendu visuel du flou est correct. Seul un test dans Firefox
(`./mach build && ./mach run`, ouvrir ce fond, vérifier la console et le
rendu) le confirmera.

==================================================================
## APPROXIMATION restante (assumée, documentée dans le code)
==================================================================

`ShaderParser.#standardInclude` reste une réimplémentation partielle et
devinée de 3 fichiers seulement (`common.h`, `common_blending.h`,
`common_composite.h`), maintenant explicitement documentée comme filet de
sécurité de dernier recours (utilisateur sans installation Steam de
Wallpaper Engine, ou en-tête que cette liste ne couvre pas). Ce n'est
volontairement PAS complété avec les vraies fonctions de `common.h` /
`common_blending.h` (`RGBToHSL`, `HSLToRGB`, tous les `BlendXXX`/`BlendXXXf`,
etc.) : l'objectif de ce correctif est que ce chemin ne soit plus jamais
emprunté en pratique dès qu'une installation Wallpaper Engine locale est
disponible, ce qui est le cas courant.
