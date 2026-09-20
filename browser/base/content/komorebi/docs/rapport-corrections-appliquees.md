# Corrections appliquées : Komorebi vs linux-wallpaperengine

Ce document reprend chaque divergence citée par les rapports d'analyse précédents
(`rapport-geometrie-couche.md`, `rapport-coordonnees-orientation.md`,
`rapport-divergences-shaders.md`, `trace-plein-ecran.md`) et indique, pour chacune,
ce qui a été RE-VÉRIFIÉ sur le code actuel (celui-ci a évolué depuis ces rapports),
ce qui a été CONFIRMÉ FAUX (corrigé ici), ce qui a été REJETÉ (l'analyse antérieure
était incorrecte), et ce qui reste volontairement NON FAIT. Chaque décision est
prouvée par un calcul à la main, dans le style de `trace-plein-ecran.md`.

Fichiers modifiés :
- `src/renderer/LayerRenderer.ts` (signe de `uRotation`)
- `src/parser/TexParser.ts`, `src/types/Asset.ts`, `src/scene/SceneLoader.ts`,
  `src/graphics/TextureUploader.ts` (mode de wrap / filtrage texture)
- `dist/renderer/LayerRenderer.js`, `dist/parser/TexParser.js`,
  `dist/types/Asset.js` (n'existe pas, type only), `dist/scene/SceneLoader.js`,
  `dist/graphics/TextureUploader.js` — régénérés par compilation TypeScript
  (voir section Build).

==================================================================
## 1. Origine + alignment de couche (D1/D2, rapport-geometrie-couche.md)
==================================================================

### Verdict : REJETÉ — le code actuel (non modifié) est déjà correct.

Les deux rapports d'analyse se contredisent déjà entre eux sur ce point
(`rapport-coordonnees-orientation.md` affirme que `layer.origin` est stocké
« centré Y-up », `rapport-geometrie-couche.md` affirme l'inverse et propose un
correctif). Aucun des deux n'avait recalculé la chaîne complète avec le uniform
`uRotation`/`uOrigin` réellement utilisé par `SceneVertexShader`. En refaisant le
calcul de bout en bout (comme `trace-plein-ecran.md` le fait pour le cas plein
écran), on constate que `SceneVertexShader` :

```
clipPosition.x = worldPosition.x / uProjection.x * 2.0 - 1.0
clipPosition.y = 1.0 - worldPosition.y / uProjection.y * 2.0
```

exige que `worldPosition` (donc `uOrigin`) soit exprimé en **espace écran brut**
`[0..W] x [0..H]`, origine en haut-gauche, Y vers le bas — exactement l'espace
dans lequel `object.origin` est lu tel quel dans le JSON Wallpaper Engine, et
exactement l'espace dans lequel `CImage.cpp` calcule `m_pos` AVANT sa conversion
finale vers l'espace centré Y-up (`CImage.cpp:236-245`, avant les lignes 259-262).//
Komorebi ne fait donc simplement jamais cette conversion finale — et n'en a pas
besoin, puisque le shader compense par la formule `1 - y/H*2` au lieu d'un vrai
MVP centré. C'est une implémentation différente mais mathématiquement équivalente.

**Preuve numérique (alignment "top", origin non nul)** — origin=(0,500), H=1080,
W=1920, taille h=200 (donc `scaledHeight/2`=100), alignment="top" :

Linux (`CImage.cpp:236-262`) :
```
m_pos.y = 500-100=400 ; m_pos.w = 500+100=600      (avant alignment)
top: m_pos.y -= 100 -> 300 ; m_pos.w -= 100 -> 500  (alignment, espace écran)
conversion: m_pos.y = 540-300=240 ; m_pos.w = 540-500=40   (centré Y-up)
centre_y_centré = (240+40)/2 = 140
clip.y (ortho H/2=540) = 140/540 ≈ 0.2593
```

Komorebi ACTUEL, sans aucune modification (`SceneModel.ts:459-460`,
`SceneVertexShader.ts:21`) :
```
origin[1] brut = 500
alignment "top": origin[1] -= scaledHeight/2 = 500-100 = 400
worldPosition.y (au centre du quad, localPosition=0) = 400
clip.y = 1 - 400/1080*2 = 1 - 0.740740... = 0.259259...
```
`0.2593 == 0.2593` → IDENTIQUE à Linux. Même vérification faite pour
`alignment="left"` sur X (origin=(300,y), W=1920, w=200) : Linux donne
clip.x=-0.5833, Komorebi (code actuel, `origin[0] += scaledWidth/2`) donne
également clip.x=-0.5833.

**Conclusion : aucune modification faite sur `SceneModel.resolveLayerGeometry`.**
Le correctif proposé par `rapport-geometrie-couche.md` (conversion explicite
`origin -= W/2`, `H/2 - origin`, alignment X inversé) aurait cassé ce résultat
correct — exactement le même type de régression que celle décrite dans
`trace-plein-ecran.md` pour le cas plein écran. Le rapport
`rapport-geometrie-couche.md` avait de plus une erreur de signe sur l'alignment
X (il proposait d'inverser left/right, alors que la conversion X de Komorebi
est une simple translation, pas une négation comme Y — le signe ne doit
PAS changer sur X, contrairement à Y).

Cas plein écran re-vérifié inchangé : origin=[W/2,H/2], alignment "center" (aucun
ajustement) → identique à `trace-plein-ecran.md`, toujours correct.

==================================================================
## 2. Matrice de frame / spritesheet, g_Texture0Rotation (§2, rapport-divergences-shaders.md)
==================================================================

### Verdict : DÉJÀ CORRIGÉ dans le code actuel (rapport obsolète).

Le rapport décrit `EffectRenderer.#setPassUniforms` construisant
`g_Texture0Rotation` en diagonale seulement (`[right-left, 0, 0, bottom-top]`)
à partir de `frame.left/top/right/bottom`, en texels bruts. Ce n'est plus le cas :
`src/parser/TexParser.ts:245-260` calcule déjà la matrice 2x2 complète et la
translation normalisée EXACTEMENT comme `CPass::resolveTextureAnimationState`
(`CPass.cpp:258-273`) :

```
translation = [x/sheetWidth, y/sheetHeight]
rotation    = [width1/sheetWidth, width2/sheetWidth, height2/sheetHeight, height1/sheetHeight]
```

et `EffectRenderer.ts:271-274` lit directement `frame.translation` /
`frame.rotation` (pas de reconstruction diagonale). Comparaison ligne à ligne
avec `CPass.cpp:265-272` : correspondance exacte des 4 composantes de rotation
et des 2 de translation. **Aucune modification nécessaire.**

==================================================================
## 3. Matrices mat4 (§3, rapport-divergences-shaders.md)
==================================================================

### Verdict : PARTIELLEMENT DÉJÀ AMÉLIORÉ, laissé tel quel (justifié).

Le rapport décrit un `if (metadata.type === "mat4") { ... IDENTITY_MATRIX; continue; }`
inconditionnel. Le code actuel (`EffectRenderer.ts:294-317`,
`#matrixUniform`) calcule déjà des matrices non-identité pour les noms connus
(`g_ModelMatrix`, `g_EffectModelMatrix`, `g_ModelViewProjectionMatrix`,
`g_EffectModelViewProjectionMatrix`, `g_ModelViewProjectionMatrixInverse`) via
`Matrix4.orthographic(layer.width, layer.height)` — analogue direct du
`m_modelMatrix = glm::ortho(0, size.x, 0, size.y)` que Linux calcule dans
`CImage.cpp` (juste avant la fin du constructeur). Seuls les noms de mat4
inconnus retombent sur IDENTITY, ce qui est un choix défendable (aucune donnée
équivalente disponible dans l'architecture actuelle pour un uniform arbitraire
non répertorié). Reconstituer le vrai MVP écran (rotation + translation +
projection caméra) façon `CImage::m_modelViewProjectionScreen` demanderait de
faire remonter jusqu'à `EffectRenderer` les mêmes données de transform que
`LayerRenderer` (origin/scale/rotation/projection), ce qui n'est pas fait
aujourd'hui. **Non modifié** : le compromis actuel est raisonnable et
documenté ; un futur travail pourrait enrichir `#matrixUniform` avec un vrai
MVP si des effets specific-name en dépendent visiblement.

==================================================================
## 4. g_TexelSize (§4, rapport-divergences-shaders.md)
==================================================================

### Verdict : DÉJÀ CORRECT, incertitude levée.

Vérifié dans `CPass.cpp:883` :
`addUniform("g_TexelSize", glm::vec2(1.0/scene.getWidth(), 1.0/scene.getHeight()))`
— c'est bien 1/PROJECTION (dimensions de scène), pas la résolution de texture.
Komorebi (`EffectRenderer.ts:266-267`) : `[1/projection[0], 1/projection[1]]`.
Identique. **Aucune modification nécessaire.**

==================================================================
## 5. Rotation de couche — signe de uRotation (D3) — BUG RÉEL CORRIGÉ
==================================================================

### Verdict : BUG CONFIRMÉ ET CORRIGÉ.

`trace-plein-ecran.md` ne pouvait pas détecter ce bug car son cas de test a
`rotation=0` (le signe n'a alors aucun effet observable). En reprenant le calcul
avec un angle non nul, le bug apparaît clairement.

Fait établi en §1 : l'espace `worldPosition` de Komorebi est le MIROIR (le long
de Y) de l'espace centré Y-up de Linux — X est identique dans les deux (pas de
flip), Y est inversé (Komorebi : 0=haut, H=bas ; Linux après conversion :
+H/2=haut, -H/2=bas). Une rotation appliquée dans un espace Y-miroir avec le
MÊME angle produit une rotation visuelle de sens OPPOSÉ. Preuve numérique :
quad centré à l'écran (960,540 en espace écran Komorebi / (0,0) en espace
centré Linux), taille 100x100, angle=90°, on suit le sommet "à droite du
centre avant rotation" (offset local (+50, 0)) :

Linux (`CImage.cpp` rotModel = rotate(-angle,Z), Y-up) :
```
offset = R(-90°)*(50,0) = (50*cos(-90), 50*sin(-90)) = (0, -50)
nouvelle position (Y-up, centré) = centre + (0,-50) = en dessous du centre
"droite" -> "dessous" = rotation VISUELLE HORAIRE (vue normale, haut=haut écran)
```

Komorebi AVANT correction (`uRotation = -layer.rotation = -90°`, espace Y-bas) :
```
offset = R(-90°)*(50,0) = (0,-50)
worldPosition = centre + (0,-50) -> Y PLUS PETIT en espace écran Y-bas = PLUS HAUT
"droite" -> "au-dessus" = rotation VISUELLE ANTI-HORAIRE
```
→ SENS INVERSÉ par rapport à Linux. Bug confirmé : l'ancien code faisait
tourner les couches dans le mauvais sens (visible sur toute couche/sous-couche
animée en rotation ou avec `angles.z` non nul au chargement — explique en
partie les "yeux à droite du visage" quand une sous-couche pivotée d'un
groupe parent est mal orientée).

Komorebi APRÈS correction (`uRotation = +layer.rotation = +90°`) :
```
offset = R(+90°)*(50,0) = (50*cos90, 50*sin90) = (0, 50)
worldPosition = centre + (0,50) -> Y PLUS GRAND en espace écran Y-bas = PLUS BAS
"droite" -> "en dessous" = rotation VISUELLE HORAIRE
```
→ IDENTIQUE à Linux (droite -> dessous, sens horaire). Corrigé.

**Fichier modifié** : `src/renderer/LayerRenderer.ts:59-65` (et
`dist/renderer/LayerRenderer.js` régénéré) :
```diff
- gl.uniform1f(gl.getUniformLocation(this.#program, "uRotation"),
-     -layer.rotation - (vertexTransform ? transformAngle : 0));
+ gl.uniform1f(gl.getUniformLocation(this.#program, "uRotation"),
+     layer.rotation + (vertexTransform ? transformAngle : 0));
```
`transformAngle` (rotation animée via l'effet "transform" mode vertex) suit le
même changement de signe que `layer.rotation`, car les deux étaient
précédemment négués ensemble (`-(layer.rotation + transformAngle)`).

**Vérification non-régression cas plein écran** : rotation=0 dans tous les cas
observés (`trace-plein-ecran.md`) → `uRotation` reste 0 avant et après le
changement de signe. Pas de régression sur le plein écran.

==================================================================
## 6. Convention Y particules vs couches (D4)
==================================================================

### Verdict : CONFIRMÉ, aucune modification.

`ParticleVertexShader.ts:15-18` n'a pas de `1 -` et `ParticleRenderer`
construit déjà les sommets en espace centré Y-up
(`y = H/2 - origin[1] + pos.y*scale`). C'est cohérent avec Linux. Les couches,
elles, utilisent un espace Y-bas brut équivalent mais différent (§1). Les deux
conventions sont **internes** à chaque composant et ne communiquent pas entre
elles (pas de mélange de coordonnées couche/particule dans un même calcul) —
donc l'hétérogénéité n'est pas un bug en soi, juste un manque d'homogénéité de
style. Non modifié : changer la convention des couches pour l'aligner sur les
particules referait le travail du §1 pour rien (le résultat final serait
identique, juste par un chemin de calcul différent), avec risque de régression
sans bénéfice fonctionnel.

La rotation des particules (`ParticleFragmentShader.ts`) est un mécanisme
séparé (rotation de la coordonnée de texture d'un point-sprite, pas une
rotation de géométrie de quad), non concerné par le bug de signe du §5.
Non modifié faute de divergence prouvée.

==================================================================
## 7. Projection caméra automatique (D6)
==================================================================

### Verdict : NON IMPLÉMENTÉ — hors périmètre raisonnable, justifié.

`CScene.cpp:37-74` calcule `width/height` depuis les extents des objets
seulement si `camera.projection.auto == true`, un champ lu depuis
`WallpaperParser.cpp:74` à partir d'un fichier de configuration caméra propre
au wallpaper (distinct de `scene.json`). Komorebi ne lit aujourd'hui AUCUNE
donnée de caméra : `SceneModel.projection` vient uniquement de
`scene.general.orthogonalprojection` (champ obligatoire côté Linux aussi,
`WallpaperParser.cpp:29` : "General section must have orthogonal projection
info"). Implémenter l'auto-projection demanderait d'ajouter un nouveau
pipeline de lecture/parsing pour ce fichier caméra, actuellement absent de
l'architecture (`RawScene.ts` ne le modélise pas). C'est une extension non
triviale et non couverte par les 5 fonds ciblés (qui utilisent
vraisemblablement `general.orthogonalprojection` fixe). Non fait, à
reconsidérer si un fond spécifique s'avère utiliser `camera.projection.auto`.

==================================================================
## 8. Parallaxe (D7)
==================================================================

### Verdict : NON IMPLÉMENTÉ — confirmé hors périmètre contenu.

Aucune donnée de parallaxe (position souris relative, `parallaxDepth`,
configuration `camera.parallax`) n'est aujourd'hui transmise à
`LayerRenderer`/`SceneVertexShader`. L'ajouter demanderait : lire
`parallaxDepth` par objet (déjà partiellement lu ? à vérifier), lire la config
`camera.parallax` (même fichier caméra absent que pour D6), calculer un
décalage supplémentaire de `uOrigin` proportionnel à la position du curseur et
à la profondeur, et le committer dans `LayerRenderer.draw`. C'est réalisable
mais couplé à l'absence du pipeline caméra (§7) — les deux devraient être faits
ensemble. Non fait dans cette passe, conformément à la consigne de ne pas
élargir l'architecture pour un gain non prouvé sur les 5 fonds ciblés.

==================================================================
## 9. Autres divergences trouvées (scan élargi CImage.cpp / CTexture.cpp)
==================================================================

### 9.1 Mode de wrap / filtrage de texture — BUG RÉEL CORRIGÉ (prudence WebGL1)

`CTexture.cpp:177-190` choisit `GL_CLAMP_TO_EDGE` ou `GL_REPEAT` et
`GL_NEAREST`/`GL_LINEAR` selon les flags du fichier `.tex`
(`TextureFlags_ClampUVs = 2`, `TextureFlags_NoInterpolation = 1`,
`Texture.h:89-96`). `TextureUploader.ts` codait en dur `CLAMP_TO_EDGE` et
`LINEAR` pour toutes les textures, quels que soient les flags. Concrètement :
les textures qui défilent/se répètent (fonds tuilés, effets de scroll sur
texture non clampée) ne se répétaient jamais côté Komorebi.

Corrigé : `TexParser.ts` expose maintenant `flags` dans `TexParseResult`
(le champ était déjà lu en local, jamais renvoyé) ; `Asset`/`SceneLoader.ts`
le propagent ; `TextureUploader.ts` applique `NEAREST` si le bit
`NoInterpolation` est posé, et `REPEAT` si le bit `ClampUVs` est ABSENT.

**Prudence WebGL1 (contrainte non présente côté Linux/OpenGL desktop)** :
`gl.REPEAT` sur une texture NPOT (non-puissance-de-2) est invalide en WebGL1 et
rend la texture "incomplete" (rendu noir). Les tex Wallpaper Engine ne sont pas
garanties POT. Le correctif calcule donc `canRepeat` à partir de
`textureWidth`/`textureHeight` et retombe sur `CLAMP_TO_EDGE` si la texture
n'est pas POT, même si le flag Linux demanderait REPEAT — c'est une contrainte
de plateforme, pas une approximation de convention, documentée en commentaire
dans le code. Par défaut (flags absents, cas des `Asset` de type "pixels" créés
sans info de flags), le comportement reste `CLAMP_TO_EDGE`+`LINEAR` identique à
avant, donc aucune régression sur les textures déjà correctement rendues.

### 9.2 Blend modes, format de texture, ordre des canaux

`CPass::#setPassState` / `EffectRenderer.#setPassState` (blending
additive/translucent/normal) comparés à `CPass::setupRenderFramebuffer`
(`CPass.cpp:129-146`) : correspondance confirmée (mêmes trois modes, mêmes
`glBlendFuncSeparate`). `LayerRenderer.draw:83`
(`gl.blendFunc(gl.SRC_ALPHA, additive ? ONE : ONE_MINUS_SRC_ALPHA)`) cohérent
avec l'équivalent Linux pour le blend final de couche. Pas de divergence
trouvée nécessitant correction.

Pas de prémultiplication d'alpha détectée d'un côté ni de l'autre — cohérent,
pas de divergence.

==================================================================
## Build / synchronisation dist/
==================================================================

Un compilateur TypeScript a été trouvé (installation locale dans un autre
répertoire scratchpad de session, `tsc` v7.0.2) et utilisé pour recompiler :
```
node <tsc> -p src/tsconfig.build.json
```
Compilation réussie sans erreur. `dist/renderer/LayerRenderer.js`,
`dist/parser/TexParser.js`, `dist/scene/SceneLoader.js`,
`dist/graphics/TextureUploader.js` ont été régénérés à partir des sources
`.ts` modifiées — pas de portage manuel JS nécessaire.

==================================================================
## Prochaine étape
==================================================================

Recharger le fond d'écran dans le navigateur (sélecteur Komorebi) et vérifier
visuellement les 5 fonds ciblés : 2703206776, 3479521040, 3759507080,
2111201226, 1179701732. Aucune des vérifications ci-dessus ne peut remplacer un
rendu WebGL réel. Porter une attention particulière à :
- toute couche/sous-couche avec `angles.z` non nul ou une animation "transform"
  de rotation (correction §5, la plus probable pour "yeux à droite du visage"
  si celui-ci vient d'une sous-couche pivotée) ;
- tout fond utilisant un défilement de texture (scroll) sur une texture non
  clampée (correction §9.1).
