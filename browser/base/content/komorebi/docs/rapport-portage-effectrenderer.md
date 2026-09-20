# Rapport d'investigation : portage du moteur de rendu Wallpaper Engine (scènes) de linux-wallpaperengine vers le renderer Komorebi (TypeScript/WebGL)

Référence fonctionnelle : https://github.com/Almamu/linux-wallpaperengine (branche `main`, commit `b016d7d`, 2026-06-08)
Cible locale : `browser/base/content/komorebi/src/` — fichier de départ `renderer/EffectRenderer.ts`

Convention adoptée dans ce document :
- **Fait** = vérifié dans le code source (lien GitHub ou chemin local + ligne citée).
- **Déduction** = conclusion tirée de l'assemblage de faits, cohérente mais non prouvée par un seul extrait.
- **Hypothèse** = supposition à vérifier, explicitement étiquetée.

---

## 1. Résumé exécutif

### Causes racines probables (architecturales, communes aux 5 cas)

1. **`EffectRenderer.run` neutralise toutes les matrices `mat4`** (`renderer/EffectRenderer.ts:84-86`) : `gl.uniformMatrix4fv(location, false, IDENTITY_MATRIX)`. Or `CPass` transmet des matrices **non triviales** (`g_ModelViewProjectionMatrix`, `g_ModelMatrix`, `g_ViewProjectionMatrix`, `g_EffectModelViewProjectionMatrix` et leurs inverses) construites par `CImage` (`CImage.cpp:381-391`, `1094-1128`). La référence lie ces matrices à `a_Position` via les passes de copie (quad `copySpacePosition`/`sceneSpacePosition`). Conséquence : tout effet dont le vertex shader dépend de la MVP (dont la vague de Rem, les masques géométriques, le flip vertical de certains fond) est rendu dans un mauvais repère. **Confiance : haute.**

2. **Résolution de texture unique imposée** (`EffectRenderer.ts:47` et `:26`) : toutes les `g_TextureNResolution` reçoivent `layer.width`/`layer.height`. Or `CPass::setupTextureUniforms` (`CPass.cpp:836-845`) attache la **résolution propre** de chaque texture/FBO (`texture->getResolution()`). Les shaders de masking/composite et d'effets localisés (`g_Texture0Resolution` notamment) lisent ces résolutions pour délimiter la zone d'effet. **Confiance : haute.** Cela explique directement pourquoi la vague de Rem s'applique à tout le corps (F cière question F).

3. **Aucun framebuffer ping-pong / FBO nommé / chain de textures** dans le renderer Komorebi. `SceneLoader.preparePassTarget` (`scene/SceneLoader.ts:120-156`) crée **un seul** FBO par passe, dimensionné à `layer.width`×`layer.height`, sans distinction original/previous/composite. `CPass` gère un graphe complexe : FBOs d'effet (`m_fbos`), `m_previousInput`, `m_input`, `target` nommés, ping-pong `m_mainFBO`/`m_subFBO` (`CImage.cpp:892-907`). Komorebi ignore `binds`, `target`, `previous`, les FBOs d'effet. **Confiance : haute.** Explique les 3 images « dans le mauvais sens » (3759507080), le « non supporté » (3479521040), et l'absence de certaines compositions.

4. **Orientation verticale / convention d'axe Y divergente** entre Linux (origine bas-gauche, `m_pos.y = sceneHeight/2 - y`) et Komorebi (`SCENE_VERTEX_SHADER` : `1.0 - worldPosition.y/uProjection.y*2.0`, origine haut-gauche). Linux n'applique **aucun flip Y** à l'upload (`CTexture.cpp` upload direct via `glTexImage2D`/`stbi_load`, pas d'inversion de lignes ; `CFBO.cpp` idem). Le flip est porté par la géométrie des quads. Komorebi non plus ne flippe pas à l'upload, mais son quad de scène et son `SceneFragmentShader` inversent l'axe Y différemment. **Confiance : haute.** Explique l'image inversée de 2703206776 et les positions « trop haut » de 3479521040.

5. **Animation des propriétés / rotation de background non transmise au pipeline d'effets.** La rotation du background de 2703206776 est évaluée dans `CImage::updateScreenSpacePosition` (`CImage.cpp:1094-1128`) et injectée dans `m_modelViewProjectionScreen` → `g_ModelViewProjectionMatrix`. Comme les matrices sont identité côté Komorebi, la rotation ne sort jamais. Le `transform` (scroll/effect) est géré séparément dans `LayerRenderer` et `EffectCompiler`, mais **la rotation du background en tant que transform de scène** ne l'est pas. **Confiance : moyenne-haute.**

6. **Catégories d'objets non gérées** : passthrough images (`CImage.cpp:605-623`, retour anticipé si pas d'effets), text objects (`CText`), puppet meshes, particles (`CParticle` complet), video textures, et surtout les **effets avec `command` (copy) et `target`** (`CImage.cpp:664-700`). Komorebi ne gère que les `material`-pass ; les `command`/`target`/effets de composition nommés sont ignorés → « non supporté » / « ne se charge pas ».

### Composants Komorebi à reprendre (par priorité)

| # | Composant | Fichier | Action |
|---|-----------|---------|--------|
| 1 | `EffectRenderer.run` | `renderer/EffectRenderer.ts` | Réécrire : matrice MVP réelle, résolution par texture, graphe de binds/target/previous/FBO, ping-pong |
| 2 | `SceneLoader.preparePassTarget` | `scene/SceneLoader.ts` | Créer les FBOs d'effet nommés + chaîne ping-pong + dimensions propres |
| 3 | `SceneModel` / `MaterialParser` | `scene/SceneModel.ts`, `parser/MaterialParser.ts` | Transmettre `target`, `binds`, `command`, FBOs d'effet |
| 4 | `LayerRenderer` + `SCENE_VERTEX_SHADER` | `renderer/LayerRenderer.ts`, `graphics/shaders/SceneVertexShader.ts` | Unifier la convention d'axe Y avec la référence |
| 5 | `TextureUploader` | `graphics/TextureUploader.ts` | Aucun flip Y à l'upload (conserver), mais documenter la convention |
| 6 | `ParticleRenderer` + `SceneModel.createParticles` | `renderer/ParticleRenderer.ts`, `scene/SceneModel.ts` | Élargir pour couvrir les pétales (cas 1179701732) |

### Ordre recommandé d'implémentation

1. **Matrices MVP dans `EffectRenderer`** (A) — bloque la vague de Rem, les flIps, la rotation de 2703206776.
2. **Résolution par texture + `g_TextureNResolution`** (B) — bloque le masquage localisé (Rem).
3. **Graphe de textures : `binds`/`target`/`previous`/FBOs d'effet + ping-pong** (C, D) — bloque 3479521040, 3759507080.
4. **Convention d'axe Y unique** (E) — corrige 2703206776 (inversion) et 3479521040 (trop haut).
5. **Animation des transforms de background** (G) — finit 2703206776.
6. **Catégories manquantes** (H, I) : passthrough, particles complètes, command-copy.

---

## 2. Carte du pipeline linux-wallpaperengine

### 2.1 Chargement du package
- `CWallpaper` → `CScene` (`Render/Wallpapers/CScene.cpp`) : parse `scene.json`, construit la caméra orthogonale (`setOrthogonalProjection`), crée les FBOs de scène (`setupFramebuffers`), le shadow atlas, les FBOs de bloom, puis `createObject` pour chaque `Object`.
- `ObjectParser` → `CImage` / `CParticle` / `CText` / `CSound`.

### 2.2 Parsing des scènes / matériaux / shaders
- `Data/Parsers/MaterialParser` (C++) charge `materials/.../*.json` → `MaterialPass` (shader, textures, combos, constants, blending, cullmode, depthtest, depthwrite).
- `Render/Shaders/Shader.cpp` + `GLSLContext` : compile `.vert`/`.frag`, résout `#include`, `#if COMBO`, macros. Produit un `Shader` avec `getVertex().getParameters()` / `getFragment().getParameters()` et `getVertex().getTextures()`.

### 2.3 Objets : `CImage` (cœur du rendu d'image + effets)
`Render/Objects/CImage.cpp` / `.h` :
- `setup()` : crée `m_mainFBO`/`m_subFBO` (ping-pong, `_rt_imageLayerComposite_<id>_a/_b`), construit les quads (`sceneSpacePosition`, `copySpacePosition`, `passSpacePosition`, `texcoordCopy`, `texcoordPass`), calcule `m_modelViewProjectionScreen/Copy/Pass` (+ inverses), `m_modelMatrix`, `m_viewProjectionMatrix`.
- `setup()` : empile les passes (matériau de base, puis effets visibles), avec FBOs d'effet (`FBOProvider`), `target` nommés, virtual passes pour `command: copy`.
- `setupPasses()` : parcourt les passes, configure inputs/destinations/targets, ping-pong, projection par passe.
- `render()` : `updateScreenSpacePosition()` (rotation + parallax dynamiques), puis `(*cur)->render()` pour chaque passe.
- `render()` final : `glColorMask(...,false)` sur la dernière passe (écrit alpha séparé pour la composition finale vers l'écran).

### 2.4 Passes : `CPass` (`Render/Objects/Effects/CPass.cpp`/.h`)
- Construit le programme GLSL, résout les uniforms (texte 0..7, résolutions, MVP, temps, pointeur, lumière, audio, composite).
- `render()` : `setupRenderFramebuffer` (viewport=FBO cible, blending, depth, cull), `setupRenderTexture` (bind texture0 + animation atlas), `setupRenderUniforms` + `setupRenderReferenceUniforms`, `setupRenderAttributes`, `renderGeometry` (VAO + 6 verts ou callback puppet), `cleanup`.
- `resolveTexture` / `resolveFBO` : distingue original / previous / FBO nommé / bind.

### 2.5 Textures & FBOs
- `CTexture` (`Render/CTexture.cpp`) : upload pixels bruts (stb_image) → **aucun flip Y**. `getResolution()` = `(textureWidth, textureHeight, realWidth, realHeight)`.
- `CFBO` (`Render/CFBO.cpp`) : texture RGBA8 + framebuffer, taille `(realWidth,realHeight)`, début transparent, wrap/filter selon flags.
- `FBOProvider` : registre des FBOs nommés d'un effet (`_rt_...`).

### 2.6 Composition finale
`CScene::renderFrame` : clear scène FBO, puis `cur->render()` par ordre de rendu. Les images écrivent dans le FBO de scène (via la dernière passe « final » dont la destination = `getScene().getFBO()`). Pas de blit séparé : la sortie vers l'écran est gérée par la couche « wallpaper » (window/screen-root) au-dessus de `CWallpaper`.

### Flux de données (image simple)
`scene.json` → `CImage::setup` → quads + FBOs → `MaterialPass` (copie texture→FBO A) → effets (passes ping-pong A↔B, écriture éventuelle dans FBO nommé `target`) → dernière passe écrit dans le FBO de scène → composite à l'écran.

---

## 3. Tableau de correspondance

| Fonctionnalité | Implémentation Linux | Implémentation Komorebi | Différence | Impact visible | Correctif architectural | Confiance |
|---|---|---|---|---|---|---|
| Matrices `mat4` transmises aux shaders | `CPass::setupUniforms` (CPass.cpp:871-882) : `g_ModelViewProjectionMatrix`, `g_ModelMatrix`, `g_ViewProjectionMatrix`, `g_EffectModelViewProjectionMatrix` + inverses, construites par `CImage` (CImage.cpp:381-391,1094-1128) | `EffectRenderer.#setPassUniforms` (EffectRenderer.ts:84-86) : `uniformMatrix4fv(..., IDENTITY_MATRIX)` pour tout `mat4` | Toutes les MVP = identité côté Komorebi | Vague de Rem sur tout le corps, flips, rotation de bg absente | Construire et transmettre les MVP réelles (quad copy/pass/screen + model) | Haute |
| Résolution par texture | `CPass::setupTextureUniforms` (CPass.cpp:836-845) : `g_TextureNResolution` = `texture->getResolution()` (réel par texture/FBO) | `EffectRenderer.ts:47` : `g_TextureNResolution = (layer.width, layer.height, layer.width, layer.height)` pour tout N | Toutes les résolutions = taille de couche | Masquage/composite localisé faux (zone d'effet = toute la couche) | Stocker `realWidth/Height` par texture/FBO et les attacher | Haute |
| Binds de texture (`previous`, nommé) | `CPass::resolveTexture` (CPass.cpp:86-109) : `previous`→`m_previousInput`, sinon `resolveFBO(bind)` | `EffectRenderer.ts:32-48` : `bind==="previous"`→`previous` (texture précédente), sinon `targets.get(bind)` | Komorebi ne gère que `previous` et target nommé simple ; pas de chaîne `m_textures` | Effets multi-passes cassés, FBOs d'effet ignorés | Implémenter `m_textures` chain + `m_fbos` + `m_previousInput`/`m_input` | Haute |
| Render targets nommés (`target`) | `CImage::configurePassTarget` (CImage.cpp:863-890) + `FBOProvider` | `EffectRenderer.ts:53-55` : `pass.target`→`targets.set(target, previous)` mais `preparePassTarget` crée 1 FBO par passe sans nom | FBOs d'effet nommés non créés | Compositions nommées absentes (ex. waterwaves) | Créer les FBOs d'effet depuis `effect.fbos` | Haute |
| Ping-pong / feedback | `CImage::pinpongFramebuffer` (CImage.cpp:892-907) : swap `m_currentMainFBO`/`m_currentSubFBO` | Aucun (1 FBO/passe) | Pas de feedback entre passes | Images « dans le mauvais sens » (3759507080), extinctions | Mécanisme de 2 FBOs par couche + swap | Haute |
| Blending / depth / cull par passe | `CPass::setupRenderFramebuffer` (CPass.cpp:128-178) | `EffectRenderer.run` : `gl.disable(BLEND)` global (l.23), `gl.enable(BLEND)` final (l.57) ; aucun depth/cull | États graphiques ignorés | Couleurs/transparences fausses | Répliquer blending/depth/cull par passe | Haute |
| Animation atlas (frames sprites) | `CPass::resolveTextureAnimationState` (CPass.cpp:246-277) : `g_Texture0Rotation`/`g_Texture0Translation` | `LayerRenderer`/`SpriteFrame` gère les frames pour la couche, mais **pas** dans `EffectRenderer` (les passes reçoivent `layer.glTexture` figée) | Frames d'animation non transmises aux effets | « Certaines images ne sont pas animées » (3479521040) | Passer `currentTexture`/`rotation`/`translation` aux passes | Moyenne |
| Orientation axe Y | Quad de scène : `m_pos.y = sceneHeight/2 - y` (origine bas-gauche) ; **aucun flip à l'upload** | `SCENE_VERTEX_SHADER` : `1.0 - y/uProjection.y*2.0` (origine haut-gauche) ; **aucun flip à l'upload** | Conventions Y opposées entre quad de scène et quads d'effet (Komorebi) | Image inversée (2703206776), position trop haut (3479521040) | Choisir UNE convention (voir §5) | Haute |
| `command: copy` / passes sans matériau | `CImage::setup` (CImage.cpp:664-700) : virtual pass `commands/copy` avec `target` | Non géré (MaterialParser ne lit que `material`) | Effets à `command` ignorés | Chargement échoue / non supporté | Parser `command` + `source` + `target` | Haute |
| Passthrough images | `CImage::setup` (CImage.cpp:605-623) : rendu spécial si `model->passthrough` | Non géré (toujours rendu comme image normale) | Fond « non supporté » | 3479521040 | Branche passthrough | Moyenne |
| Particles | `CParticle` complet (`Render/Objects/CParticle.cpp`, CPass-based, rendu sprites/rope) | `ParticleRenderer` + `SceneModel.createParticles` : approximation (max 64, box/sphere emitter, movement/gravity) | Pétales simplifiés ou absents | 1179701732 (pétales absents) | Élargir (voir I) | Moyenne |
| `g_Time` / `g_Daytime` | `CPass::setupUniforms` (CPass.cpp:869-870) : pointeurs vers `g_Time`/`g_Daytime` globaux | `EffectRenderer.ts:89-90` : `g_Time`/`g_Daytime` = `elapsed` | Équivalent (OK) | — | Conserver, mais vérifier unité (secondes) | Haute |
| Uniforms de matériau (`constantshadervalues`) | `CPass::setupShaderVariables` (CPass.cpp:978-1000) : override > pass > défaut shader | `MaterialParser.resolvePass` (MaterialParser.ts:96-99) : fusion pass+override ; `EffectRenderer` lit `pass.constants` | Équivalent (OK) | — | Conserver | Haute |
| Uniforms `g_TexelSize`/`g_Composite*` | CPass.cpp:883-884, 865-867 | EffectRenderer.ts:93-94 (texelSize) ; composite non géré | Composite partiellement absent | Compositions fausses | Ajouter composite uniforms | Moyenne |
| Uniforms audio (`g_AudioSpectrum*`) | CPass.cpp:885-890 | Absent (hors périmètre) | — | À signaler comme différé, pas un bug | (périmètre exclu) | Haute |
| Uniforms pointeur (`g_PointerPosition`) | CPass.cpp:879-880 | EffectRenderer.ts:91-92 | Équivalent (hors périmètre visuel) | — | (périmètre exclu) | Haute |

---

## 4. Analyse détaillée de `CPass`

### 4.1 Construction
`CPass::CPass` (CPass.cpp:45-57) reçoit : `renderable` (CImage), `fboProvider`, `MaterialPass`, `override` (ImageEffectPassOverride), `binds` (`TextureMap`), `target` (string nommé). `setupShaders` (596-690) compile le programme, résout les combos (dont `TEX0FORMAT` selon `texture0->getFormat()`, 605-611), et prépare uniforms/attribs.

### 4.2 Textures
- `setupTextureUniforms` (697-845) : pour chaque texture déclarée dans le vertex/fragment shader, le `MaterialPass`, et les `usertextures`/override, résout via `resolveFBO` (si nom commence par `_rt_`/`_alias_`) sinon `getContext().resolveTexture`. Construit une **chaîne** `m_textures[index]` (linked list permettant le fallback si une texture n'est pas prête).
- `g_Texture0..7` enregistrés (824-831) ; `g_TextureReductionScale=1` ; `g_Texture0Resolution` = résolution de la texture0.

### 4.3 Passes & 4.4 Render targets
- `render()` (454-508) : skip si `m_drawTo==nullptr` ou `m_input==nullptr` (491-499). Sinon framebuffer cible → texture0 → uniforms → référence → attribs → geometry → cleanup.
- `m_drawTo` (destination FBO) est fixé par `CImage::setupPasses` : soit le FBO ping-pong de la couche, soit le FBO de scène (dernière passe finale), soit un FBO nommé `target`.

### 4.5 Uniforms & 4.6 Matrices
- `setupUniforms` (848-891) attache (par pointeur, mis à jour chaque frame) :
  - `g_ModelViewProjectionMatrix` / `g_ModelViewProjectionMatrixInverse` → `m_modelViewProjectionMatrix` (passé par `CImage::setModelViewProjectionMatrix`, CImage.cpp:837).
  - `g_EffectModelViewProjectionMatrix` → idem.
  - `g_ModelMatrix` → `m_modelMatrix` (ortho local, CImage.cpp:390).
  - `g_ViewProjectionMatrix` → `m_viewProjectionMatrix` (identité pour image, CImage.cpp:391).
  - `g_NormalModelMatrix` = identité 3×3.
  - `g_EffectTextureProjectionMatrix`/`Inverse` = identité.
- Ces matrices sont **utilisées par les vertex shaders des passes** (quad copy/pass/screen) pour transformer `a_Position`. **Komorebi les remplace par l'identité** → le vertex shader des passes reçoit des positions déjà en clip-space (FULLSCREEN_VERTICES de `ScreenQuad`), donc tout effet géométrique (rotation, masque spatial, flip) est perdu.

### 4.7 Temps
`g_Time`/`g_Daytime` pointent vers les globals (`extern float g_Time` en haut de CPass.cpp:29). Mis à jour par `CScene::renderFrame`. Komorebi : `elapsed` = `(timestamp-animationStart)/1000` (RenderPipeline.ts:57) — unité identique (secondes). OK.

### 4.8 États graphiques
`setupRenderFramebuffer` (121-178) : viewport = `m_drawTo` (taille réelle du FBO), blending (`Translucent`/`Additive`/`Normal`/`none`), depthtest (LEQUAL/none), cullface, depthmask. **Komorebi désactive globalement le blend avant la boucle** (EffectRenderer.ts:23) et ne gère ni depth ni cull par passe.

### 4.9 Sortie finale
`CImage::render` (909-950) : sur la **dernière** passe, `glColorMask(true,true,true,false)` (941) — n'écrit pas l'alpha dans le FBO de scène (l'alpha final est composé séparément par la couche wallpaper). Komorebi : `LayerRenderer.draw` écrit `uOpacity` dans `gl_FragColor.a` directement vers l'écran, sans cette sémantique de masque d'écriture.

---

## 5. Analyse des transformations et orientations

### 5.1 Convention de coordonnées Linux (référence)
- Espace scène : origine **centre**, Y vers le **haut** (caméra orthogonale centrée, CScene.cpp `setOrthogonalProjection`).
- `CImage` calcule `m_pos` (boîte englobante) ainsi (CImage.cpp:1011-1014) :
  ```
  m_pos.x -= sceneWidth/2;
  m_pos.y = sceneHeight/2 - m_pos.y;   // ← inversion Y : passage centre→bas-gauche
  m_pos.z -= sceneWidth/2;
  m_pos.w = sceneHeight/2 - m_pos.w;
  ```
  Donc le quad de copie `copySpacePosition` (CImage.cpp:345-346, 1057-1058) est en **origine bas-gauche**, comme l'attend OpenGL (texture UV (0,0) en bas-gauche).
- **Upload des pixels** (`CTexture.cpp`) : `glTexImage2D` direct, **aucune inversion de lignes**, **pas de `UNPACK_FLIP_Y`** (inexistant en OpenGL desktop). Les pixels du `.tex` (décodés stb_image, qui livre le haut en premier) sont placés tels quels → la première ligne du fichier image finit en **haut** du tampon texture, soit UV.v=1 en haut. Le quad de scène échantillonne avec `v=0` en bas → cohérent.
- **Framebuffers** (`CFBO.cpp`) : texture RGBA8, même convention bas-gauche (GL standard). Une texture issue d'un FBO a donc l'orientation GL standard.
- **Quad final écran** : la sortie vers l'écran est faite par la couche wallpaper (hors `CPass`) ; le FBO de scène est lui-même en convention GL (bas-gauche).

### 5.2 Où un flip vertical peut être introduit côté Komorebi
1. **`TextureUploader`** (`graphics/TextureUploader.ts`) : **aucun `UNPACK_FLIP_Y_WEBGL`** (lignes 10-48). Les pixels sont uploadés tels quels. *Cohérent avec Linux* — mais attention : en WebGL, `createImageBitmap` + `texImage2D(bitmap)` place le **haut** de l'image en **haut** du tampon (comme GL). Donc pas de flip ici. ✅
2. **`SCENE_VERTEX_SHADER`** (`graphics/shaders/SceneVertexShader.ts:21`) : `clipPosition.y = 1.0 - worldPosition.y/uProjection.y*2.0`. Cela remonte l'origine en **haut-gauche** pour l'affichage écran. C'est une convention **écran** (Y bas→haut inversé). ✅ pour l'écran, mais **diverge** de la convention Linux si les mêmes coordonnées sont réutilisées pour les effets.
3. **`SceneFragmentShader`** (`graphics/shaders/SceneFragmentShader.ts:16`) : `uv = (vTexCoord - uTextureOrigin)/uTextureSize`. `vTexCoord` vient de `aTexCoord` = `FULLSCREEN_UVS` (`geometry/Geometry.ts:21-28`) → `(0,1)` en haut, `(0,0)` en bas. **Dans Komorebi, le ScreenQuad a UV.v=1 en haut**, alors que Linux (quad copy) a `texcoordCopy = (x, height, ...)` avec `height = realHeight/textureHeight` et le bas à `y=0` (CImage.cpp:343,1056). → **Inversion d'UV entre les deux** pour les effets qui échantillonnent `g_Texture0` via `a_TexCoord`.
4. **`EffectRenderer` dessine toujours avec `FULLSCREEN_VERTICES`/`FULLSCREEN_UVS`** (EffectRenderer.ts:30-31, `ScreenQuad`). Or Linux utilise `passSpacePosition` (plein écran clip-space, CImage.cpp:350-351) pour les passes N≥1 mais `copySpacePosition`/`sceneSpacePosition` (géométrie d'image, en repère scène via MVP) pour la 1re passe et la finale. **Komorebi ne distingue pas** : toutes les passes reçoivent le même quad plein écran, et la MVP est identité → l'image d'origine n'est jamais remappée à sa position/taille réelle.

### 5.3 Recommandation : une convention unique
Adopter la convention **GL (origine bas-gauche, UV (0,0) en bas)** partout côté Komorebi :
- Ne **jamais** flipper à l'upload (conserver l'absence de `UNPACK_FLIP_Y_WEBGL`).
- Pour les effets, utiliser un quad plein écran en clip-space (comme `passSpacePosition`) et laisser le shader échantillonner via UV GL standard ; corriger `SCENE_VERTEX_SHADER` pour ne pas inverser Y (ou isoler l'inversion au blit final vers canvas).
- Stocker `m_pos` (boîte englobante) et les MVP `copy`/`screen`/`pass` exactement comme `CImage` (§4.6), et les transmettre aux passes via `a_Position` + `g_ModelViewProjectionMatrix`.

---

## 6. Analyse des animations

### 6.1 Propriétés animées (référence)
- `DynamicValue` / `UserSetting` : `origin`, `scale`, `angles`, `alpha`, `color`, `visible`, `parallaxDepth` peuvent être animés (scripts QuickJS ou keyframes).
- Pour les **images**, la rotation de background est dans `angles.z` (radians) ; `CImage::updateScreenSpacePosition` (CImage.cpp:1094-1128) la lit, construit `rotModel` (rotation -angle autour du centre de l'image, négation pour système Y-flippé, CImage.cpp:1099-1105), et compose `m_modelViewProjectionScreen = projection * lookAt * rotModel`.
- Pour les **effets** (`transform`/`scroll`), les valeurs sont dans `constantshadervalues` et évaluées par le moteur de script ; `CPass::setupShaderVariables` (978-1000) les attache.

### 6.2 Évaluation temporelle et transmission
- Linux : `g_Time` global, recalculé chaque frame dans `CScene::renderFrame`. Les MVP sont recalculées dans `updateScreenSpacePosition` (appelée à chaque `render()`).
- Komorebi : `elapsed` transmis à `EffectRenderer` (RenderPipeline.ts:65) et à `LayerRenderer` (draw). `LayerRenderer` évalue `transform.angle/offset/scale` via `sampleProperty` (LayerRenderer.ts:39-41) — **mais seulement pour le mode transform (effect), pas pour la rotation de background de l'objet image**. `EffectRenderer` reçoit `elapsed` mais ne l'utilise que pour `g_Time`/`g_Daytime` (EffectRenderer.ts:89-90).

### 6.3 Raisons possibles des images statiques (3479521040)
1. **Frames d'animation non transmises aux passes** : `EffectRenderer` reçoit `layer.glTexture` figée (RenderPipeline.ts:65), sans `currentTexture`/`rotation`/`translation` (voir §3, ligne animation atlas). Les spritesheets (pétales, séquences) ne progressent donc pas à travers les effets.
2. **Rotation de background non transmise** (2703206776) : `m_modelViewProjectionScreen` non calculée → la MVP identité laisse l'image immobile.
3. **`updateScreenSpacePosition` absente** côté Komorebi : aucune mise à jour dynamique des MVP par frame.
4. **`transform` mode 1 (déplacement du vertex de la couche)** géré dans `LayerRenderer` (LayerRenderer.ts:42,69) mais pas dans `EffectRenderer` — or pour 3479521040 les images « ne sont pas animées » au niveau de la couche, suggérant que même le chemin `LayerRenderer` échoue (peut-être parce que `transform.enabled` n'est pas détecté, ou que l'animation est portée par un effet et non par `constantshadervalues`).

---

## 7. Analyse du masking et de la portée des effets

### 7.1 Comment Linux délimite la zone d'un effet
- Un effet localisé (ex. vague de Rem sur vêtements/cheveux) utilise typiquement :
  - une **texture de masque** (composite map / mask) bindée sur `g_TextureN` ;
  - des **combos** `COMPOSITE`/`COMPOSITEMONO`/`MASK` (cf. `common_composite.h` dans `ShaderParser.ts:396-425`) ;
  - `g_Texture0Resolution` / `g_TextureNResolution` pour mapper le masque dans l'espace de l'image ;
  - la **MVP** pour projeter la zone masquée dans le repère du shader.
- `CPass::setupTextureUniforms` attache la résolution **réelle** de chaque texture (CPass.cpp:836-845). Si le shader calcule `uv_mask = vUv * g_Texture0Resolution.xy / g_TextureNResolution.xy`, une mauvaise résolution fausse tout le mapping.

### 7.2 Pourquoi la vague de Rem touche tout le corps (2111201226)
- **Cause probable** : (a) `g_TextureNResolution` = `layer.width/height` (EffectRenderer.ts:47) au lieu de la résolution du masque → le masque est étiré sur toute la couche ; (b) les MVP sont identité → la projection de la zone masquée est ignorée ; (c) le masque/composite (`COMPOSITE`/`MASK` combos) n'est peut-être pas résolu car `ShaderParser` le gère côté Komorebi (`common_composite.h`) mais `EffectRenderer` n'attache pas `g_CompositeColor`/`g_CompositeAlpha`/`g_CompositeOffset`.
- **Corollaire « suspendue tête en bas »** : la MVP identité + l'inversion d'UV du `ScreenQuad` (§5.2.3) fait que l'image est rendue retournée ; le flip vertical de Rem vient de la combinaison (effet de vague qui déplace les UV + quad inversé).
- **Confiance : haute** pour (a)+(b) ; moyenne pour le rôle exact du combo MASK (à vérifier sur le `.json` de l'effet Rem).

---

## 8. Analyse du chargement et des fonctionnalités non supportées

### 8.1 Chemins d'erreur Linux
- `CScene::dispatchObjectType` (CScene.cpp) : objet inconnu → placeholder `CObject` (ne rend rien) ; particules désactivées par setting → `nullptr`.
- `CImage::setup` : `passthrough` sans effets → retour (pas de rendu) ; effet non visible → skip.
- `CPass::setupShaders` : shader introuvable / combos manquants → exception (log).
- `MaterialParser` (C++) : matériau introuvable → exception.
- `CWallpaper` : format de texture non supporté → exception.

### 8.2 Formats / objets / shaders non gérés par Komorebi (→ « non supporté » / échec)
- **`command: copy` + `target`** (CImage.cpp:664-700) : Komorebi ne parse que `material`. → 3479521040 (fond signalé non supporté), 3759507080 (ne se charge pas).
- **passthrough** (CImage.cpp:605-623) : non géré → fonds spéciaux ignorés.
- **FBOs d'effet nommés** (`effect.fbos`, CImage.cpp:652-654) : non créés → compositions manquantes.
- **Textes (`CText`)** : absent côté Komorebi.
- **Puppet meshes** : `SceneModel.createLayer` les lit (`readPuppet`) et `SceneLoader.preparePuppet` crée les buffers, mais `EffectRenderer` ne les utilise pas (toujours `ScreenQuad`) → déformations puppet perdues.
- **Video textures** : `SceneLoader.prepareVideoTexture` les charge, mais `updateVideoTexture` ne met à jour que `layer.glTexture` pour `LayerRenderer` ; `EffectRenderer` ne reçoit pas le frame vidéo à travers les passes.
- **Formats de texture** : `TexParser` gère RGBA8888, R8, RG8, DXT1/3/5, mp4. Linux gère aussi d'autres formats (freeImage). Pas de blocage majeur identifié ici.

### 8.3 Cas 3479521040 / 3759507080
- 3479521040 « non supporté » + positionnement trop haut + images non animées → **combinaison** de : passthrough/command non géré (non supporté), convention Y (trop haut), animation atlas non transmise (non animé).
- 3759507080 « ne se charge pas » + 3 images + background dans le mauvais sens → **échec de parsing/setup** probable (effet avec `command`/`target` ou FBO manquant provoquant une exception non rattrapée dans `MaterialParser`/`EffectRenderer`), puis rendu inversé (Y).

---

## 9. Diagnostic par fond d'écran

### 9.1 1179701732 — pétales de roses absentes
- **I. Catégorie** : les pétales sont des **particules** (`CParticle`, CParticle.h). Preuve : Wallpaper Engine utilise un système de particules pour les pétales ; côté Komorebi, `SceneModel.createParticles` (SceneModel.ts:145-206) les détecte mais avec une approximation sévère (max 64, box/sphere emitter seul, movement+gravity, sans `controlpoint`, `alphaFade`, `sizeChange`, `oscillate`, spritesheet complet, ni rope/trail).
- **Cause probable** : soit le système de particules n'est pas détecté (matériau/initializer non couvert), soit le rendu est trop simplifié pour produire des pétales visibles.
- **Composants** : `SceneModel.createParticles`, `ParticleRenderer`, `parser/ParticleSystem`.
- **Vérifications** : ouvrir `scene.json` de 1179701732 → vérifier `object.particle` présent, son `material`, `initializer` (colorrandom/sizerandom/lifetimerandom), `emitter` (type), `operator` (movement/gravity). Comparer avec les capacités de `createParticles`.
- **Confiance : moyenne** (à confirmer sur le `.json` réel).

### 9.2 3479521040 — non supporté / trop haut / non animé
- **Cause probable** : (1) fond passthrough ou effet `command` non géré → « non supporté » ; (2) convention Y (§5) → trop haut ; (3) animation atlas non transmise (§6.3) → non animé.
- **Composants** : `MaterialParser`, `EffectRenderer`, `SceneVertexShader`, `SpriteFrame`/`LayerRenderer`.
- **Vérifications** : lire `scene.json` (est-ce `passthrough` ? y a-t-il des `command` ?), les `alignment` des images, et si les textures sont des spritesheets.
- **Confiance : haute** pour la conjonction.

### 9.3 2703206776 — inversé + background immobile
- **Cause probable** : (1) flip vertical = combo UV `ScreenQuad` inversé (§5.2.3) + MVP identité ; (2) rotation du background absente car `m_modelViewProjectionScreen` non calculée (§6.2).
- **Composants** : `EffectRenderer` (matrices), `SceneVertexShader` (Y), `SceneModel.resolveLayerGeometry` (rotation non transmise aux effets).
- **Vérifications** : confirmer que l'objet a `angles.z != 0` et qu'aucun effet ne le compense ; vérifier l'orientation attendue vs rendue.
- **Confiance : haute**.

### 9.4 3759507080 — ne se charge pas / 3 images + background inversés
- **Cause probable** : exception de setup non rattrapée (effet `command`/`target` ou FBO manquant → `MaterialParser`/`EffectRenderer` échoue) ; rendu inversé une fois le contenu interprété (même cause Y que 2703206776).
- **Composants** : `MaterialParser`, `SceneLoader.preparePassTarget`, `EffectRenderer`.
- **Vérifications** : capturer la console (Komorebi logge `console.error` dans `SceneLoader.prepareMaterialPasses` et `MaterialParser`) ; lire `scene.json` pour les `command`/`target`/`fbos`.
- **Confiance : moyenne-haute**.

### 9.5 2111201226 — vague sur tout le corps + Rem tête en bas
- **Cause probable** : (1) masque non localisé car `g_TextureNResolution` unique (§7.2) + MVP identité ; (2) Rem inversée car flip UV du `ScreenQuad` (§5.2.3) + MVP identité.
- **Composants** : `EffectRenderer` (résolutions + matrices), `ShaderParser` (combos COMPOSITE/MASK), `LayerRenderer` (Y).
- **Vérifications** : ouvrir l'effet Rem (`effects/.../effect.json`) → lire ses `passes`, `textures` (y a-t-il un masque ?), `combos` (COMPOSITE/MASK), `constantshadervalues`. Confirmer que le masque est bindé sur un `g_TextureN` et que sa résolution est attendue.
- **Confiance : haute**.

---

## 10. Plan de portage

### Étape 1 — Matrices MVP réelles dans `EffectRenderer`
- **Fichiers** : `renderer/EffectRenderer.ts`, `types/Layer.ts` (ajouter champs MVP), `scene/SceneModel.ts` (calculer `m_modelMatrix`/`m_viewProjectionMatrix`/`m_modelViewProjectionScreen/Copy/Pass` + inverses, reproduire CImage.cpp:381-391, 1011-1014, 1067-1073, 1094-1128).
- **Comportement Linux** : transmettre `g_ModelViewProjectionMatrix`, `g_ModelViewProjectionMatrixInverse`, `g_ModelMatrix`, `g_EffectModelViewProjectionMatrix`, `g_ViewProjectionMatrix` (CPass.cpp:871-882) au lieu de l'identité.
- **Tests** : shader de test qui applique une rotation MVP → Rem doit tourner ; un quad copy doit conserver la position/taille de l'image.
- **Risques** : régression si les quads (`a_Position`) ne sont pas en repère scène ; nécessite l'étape 4 (quads corrects).
- **Dépendances** : Étape 4 (géométrie).

### Étape 2 — Résolution par texture
- **Fichiers** : `renderer/EffectRenderer.ts:47`, `types/Material.ts`/`Layer.ts` (stocker `realWidth/Height` par texture/FBO), `scene/SceneLoader.ts` (dimensionner les FBO aux tailles réelles).
- **Comportement Linux** : `g_TextureNResolution` = `texture->getResolution()` (CPass.cpp:836-845).
- **Tests** : shader de masque localisé → ne doit plus couvrir toute la couche.
- **Risques** : FBO de taille incorrecte si `layer.width/height` ≠ taille texture.
- **Dépendances** : Étape 3 (FBO par texture).

### Étape 3 — Graphe de textures (binds/target/previous/FBO/ping-pong)
- **Fichiers** : `renderer/EffectRenderer.ts` (réécrire la boucle), `scene/SceneLoader.ts` (créer FBOs d'effet nommés depuis `effect.fbos`, mécanisme ping-pong 2 FBOs/couche), `parser/MaterialParser.ts` (transmettre `target`, `binds`, `command`, `source`, FBOs), `types/RawScene.ts`/`Layer.ts` (nouveaux champs).
- **Comportement Linux** : `CPass::resolveTexture` (86-109), `CImage::configurePassTarget` (863-890), `pinpongFramebuffer` (892-907).
- **Tests** : effet multi-passes avec `target`/`previous` ; fond 3479521040/3759507080 doit se charger.
- **Risques** : ordre des passes, fuites de FBO, perf.
- **Dépendances** : Étape 2.

### Étape 4 — Convention d'axe Y unique + quads corrects
- **Fichiers** : `graphics/shaders/SceneVertexShader.ts`, `graphics/geometry/Geometry.ts` (FULLSCREEN_UVS), `renderer/EffectRenderer.ts` (quads copy/pass/screen selon CImage.cpp:343-351,1056-1058), `renderer/LayerRenderer.ts`.
- **Comportement Linux** : origine bas-gauche GL partout ; pas de flip à l'upload.
- **Tests** : image avec `angles.z` → doit apparaître droite ; 2703206776 non inversé ; 3479521040 non « trop haut ».
- **Risques** : casser l'affichage écran actuel si le blit final dépend de l'inversion.
- **Dépendances** : Étape 1.

### Étape 5 — Animation des transforms de background
- **Fichiers** : `scene/SceneModel.ts` (`updateScreenSpacePosition` équivalent, recalcul MVP par frame), `renderer/EffectRenderer.ts` (recevoir les MVP mises à jour), `renderer/RenderPipeline.ts` (appeler le recalcul par frame).
- **Comportement Linux** : CImage.cpp:1094-1128 (rotation -angle, parallax).
- **Tests** : 2703206776 background doit tourner.
- **Risques** : coût par frame.
- **Dépendances** : Étapes 1, 4.

### Étape 6 — Catégories manquantes
- **Fichiers** : `parser/MaterialParser.ts` (`command`/`source`/`target`), `scene/SceneModel.ts` (passthrough, text), `renderer/ParticleRenderer.ts` + `scene/SceneModel.ts` (particules complètes : controlpoint, alphaFade/sizeChange/oscillate, spritesheet, rope/trail), `renderer/EffectRenderer.ts` (puppet geometry callback).
- **Comportement Linux** : CImage.cpp:605-623, 664-700, 548-594 ; CParticle complet.
- **Tests** : 1179701732 (pétales), 3479521040/3759507080 (chargement).
- **Risques** : gros surface ; à faire après les étapes 1-5.
- **Dépendances** : Étapes 1-3.

---

## 11. Informations encore manquantes

À ne **pas** combler par supposition. Ces points nécessitent soit l'accès aux `.json`/`.tex` des 5 fonds, soit la lecture de fichiers Linux non encore ouverts :

1. **Contenu exact des `scene.json` et `effect.json` des 5 IDs** (1179701732, 3479521040, 2703206776, 3759507080, 2111201226) : présence de `passthrough`, `command`, `target`, `fbos`, masques/composites, spritesheets, `angles.z`. → nécessaire pour confirmer les diagnostics §9.
2. **`CScene::renderFrame` (partie manquante, lignes ~318-460)** : comment le FBO de scène est blitté/affiché à l'écran (le verrou final de composition). Le cache lu s'arrête avant. → nécessaire pour la convention Y finale (§5.3).
3. **`FBOProvider.cpp` / `CFBO.h` (create/alias/find)** : détails de résolution des FBOs nommés et du `scale`.
4. **`GLSLContext` / `ShaderUnit`** : comment les `#include` et combos sont résolus côté Linux (Komorebi a son propre `ShaderParser` ; à valider l'équivalence pour `COMPOSITE`/`MASK`/`TEX0FORMAT`).
5. **`CRenderable` / `CObject`** : `getTexture()`, `getAnimationTime()`, `getBrightness()` etc. (valeurs par défaut des uniforms de matériau).
6. **Effet Rem exact** (2111201226) : fichier `effects/.../effect.json` + ses `passes`/`textures`/`combos` pour confirmer le mécanisme de masque (COMPOSITE vs MASK vs texture dédiée).
7. **`Camera::setOrthogonalProjection` / `getLookAt` / `getProjection`** : valeurs exactes (largeur/hauteur, centrage) pour reproduire `m_modelViewProjectionScreen` à l'identique.
8. **Comportement des particules 1179701732** : type d'emitter, initializers, operators réels — pour savoir si l'approximation Komorebi suffit ou doit être étendue.

---

## Annexes — liens précis

- `CPass.cpp` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Objects/Effects/CPass.cpp
  - `render()` : 454-508 · `setupRenderFramebuffer` : 121-178 · `setupTextureUniforms` : 697-845 · `setupUniforms` (MVP) : 848-891 · `resolveTexture` : 86-109 · `resolveTextureAnimationState` : 246-277
- `CPass.h` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Objects/Effects/CPass.h
- `CImage.cpp` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Objects/CImage.cpp
  - `setup()` : 596-782 · `setupPasses` : 784-852 · `configurePassTarget` : 863-890 · `pinpongFramebuffer` : 892-907 · `updateScreenSpacePosition` : 1094-1128 · `m_pos` Y-flip : 1011-1014
- `CImage.h` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Objects/CImage.h
- `CScene.cpp` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Wallpapers/CScene.cpp
- `CTexture.cpp` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/CTexture.cpp (upload, aucun flip Y)
- `CFBO.cpp` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/CFBO.cpp
- `CParticle.h` : https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Objects/CParticle.h

Fichiers Komorebi concernés (chemins locaux) :
- `renderer/EffectRenderer.ts` · `renderer/LayerRenderer.ts` · `renderer/RenderPipeline.ts` · `renderer/ParticleRenderer.ts`
- `scene/SceneModel.ts` · `scene/SceneLoader.ts` · `parser/MaterialParser.ts` · `parser/ShaderParser.ts` · `parser/TexParser.ts`
- `graphics/TextureUploader.ts` · `graphics/GraphicsContext.ts` · `graphics/geometry/Geometry.ts` · `graphics/geometry/ScreenQuad.ts` · `graphics/geometry/LayerQuad.ts`
- `graphics/shaders/SceneVertexShader.ts` · `graphics/shaders/SceneFragmentShader.ts` · `math/Matrix4.ts` · `effects/EffectCompiler.ts` · `effects/TransformEffect.ts` · `effects/AnimatedProperty.ts`
