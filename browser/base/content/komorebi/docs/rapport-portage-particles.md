# Investigation : portage du moteur de particules Wallpaper Engine (linux-wallpaperengine) vers Komorebi

Référence fonctionnelle : `Almamu/linux-wallpaperengine` (branche `main`, commit `b016d7d`, 2026-06-08).
Cible locale : `browser/base/content/komorebi/src/` (Komorebi-Firefox).

Ce document décrit **uniquement** ce que fait le code source de référence, compare avec l'implémentation
Komorebi, et signale toute logique Komorebi sans équivalent démontré dans Linux. Aucun correctif, aucune
approximation ni algorithme inventé.

---

## 0. Périmètre et limites de la source

### Faits prouvés sur la provenance des shaders de particules Linux

- `CParticle::setupPass` (`CParticle.cpp:1641-1693`) force le shader via l'override :
  - `m_passOverride->shaderOverride = "genericropeparticle"` si `m_useRopeRenderer` (`CParticle.cpp:1652-1654`)
  - sinon le shader par défaut du matériau de particule (un effet WE standard `genericparticle`), activé
    via les combos `THICKFORMAT` (toujours), `SPRITESHEET` (si spritesheet), `TRAILRENDERER` (si trail)
    (`CParticle.cpp:1650-1660`).
- Le dossier `src/WallpaperEngine/Render/Shaders/` du dépôt ne contient **que** :
  `GLSLContext.{cpp,h}`, `Shader.{cpp,h}`, `ShaderUnit.{cpp,h}`, `Variables/` (vérifié via l'API GitHub
  `contents/src/WallpaperEngine/Render/Shaders`).
- Les noms `genericparticle`, `genericropeparticle`, `common_particles.h` **n'apparaissent pas** comme
  fichiers `.vert`/`.frag`/`.glsl` dans le dépôt. Ils sont les shaders HLSL de Wallpaper Engine, transpilés
  à la volée par `ShaderUnit`/`GLSLContext` (les sous-modules `glslang-WallpaperEngine` et
  `SPIRV-Cross-WallpaperEngine` sont déclarés dans `.gitmodules`).
- `CPass::setupShaders`/`ShaderUnit` compilent donc le GLSL généré à partir du HLSL d'origine. Le GLSL
  final n'est pas consultable directement ici.

**Conséquence (incertitude assumée et non comblée) :** le contenu exact des shaders `genericparticle` /
`genericropeparticle` (les attributs `a_PositionVec4`, `a_TexCoordVec4C1`, la fonction `ComputeSpriteFrame`,
`ComputeParticleTrailTangents`, etc. mentionnés dans les commentaires de `CParticle.cpp`) n'est **pas**
vérifiable dans ce dépôt. Les descriptions ci-dessous des *attributs attendus par les shaders* proviennent
des commentaires du code C++ (`renderSprites`/`renderRope`) et sont traitées comme **faits sur le layout
de vertex CPU**, pas comme preuve du GLSL.

---

## 1. Pipeline de particules Linux — faits par composant

### 1.1 Parsing (`ObjectParser.cpp`)

Le parseur lit `scene.json` → `parseParticle` (`ObjectParser.cpp:286-535`) :
- Champs objet de base : `scale`, `angles`, `visible`, `parallaxDepth` (via `it.user`, donc résolution
  `UserSetting`/valeur animée), `origin` (`ObjectParser.cpp:301-303, 509-513`).
- Le `particle` peut être une chaîne (chemin de fichier `.json` lu via `project.assetLocator->readString`)
  ou un objet inline (`ObjectParser.cpp:332-348`).
- Champs lus du JSON de particule (`ObjectParser.cpp:350-528`) :
  - `emitter[]` → `parseParticleEmitter` (`ObjectParser.cpp:537-623`)
  - `initializer[]` → `parseParticleInitializer` (`ObjectParser.cpp:625-676`)
  - `operator[]` → `parseParticleOperator` (`ObjectParser.cpp:678-759`)
  - `renderer[]` → `parseParticleRenderer` (`ObjectParser.cpp:761-785`)
  - `controlpoint[]` → `parseParticleControlPoint` (`ObjectParser.cpp:787-813`)
  - `children[]` → `parseParticleChild` (`ObjectParser.cpp:815-865`)
  - `instanceoverride` → `parseParticleInstanceOverride` (`ObjectParser.cpp:867-879`)
  - `material` (chemin vers un `.material` wrappé dans un `ModelStruct`, `ObjectParser.cpp:446-472`)
  - `animationmode` (défaut `"sequence"`, `ObjectParser.cpp:475-479`)
  - `sequencemultiplier` (défaut 1.0), `maxcount` (défaut 100), `starttime` (0), `flags` (0)
    (`ObjectParser.cpp:481-505`).
- Si aucun `renderer` : un renderer `sprite` par défaut est ajouté (`ObjectParser.cpp:392-409`) avec
  `length=0.05, maxlength=10, minlength=0, subdivision=1, segments=4, uvScale=1, uvScrolling=false,
  uvSmoothing=true, fadeAlpha=false, fadeSize=false`.

**Émetteur (`parseParticleEmitter`, `ObjectParser.cpp:537-623`) — faits :**
- `name` (boxrandom / sphererandom), `directions` (défaut (1,1,0)), `distancemin` (0), `distancemax`
  (256,256,0), `origin` (0), `sign` (ivec3 0), `instantaneous` (0), `speedmin`/`speedmax` (0), `rate`
  (10), `controlpoint` (0), `flags` (0).
- Champs **manquants côté Komorebi** lus ici : `delay`, `duration`, `minperiodicdelay`,
  `maxperiodicdelay`, `minperiodicduration`, `maxperiodicduration`, `cone`, et tout le bloc
  `audioProcessing*` (`audioprocessingmode/bounds/exponent/frequencystart/end`).

**Initializers (`parseParticleInitializer`, `ObjectParser.cpp:625-676`) — faits :** 9 types reconnus :
`colorrandom`, `sizerandom`, `alpharandom`, `lifetimerandom`, `velocityrandom`, `rotationrandom`,
`angularvelocityrandom`, `turbulentvelocityrandom`, `mapsequencearoundcontrolpoint`.

**Operators (`parseParticleOperator`, `ObjectParser.cpp:678-759`) — faits :** 12 types reconnus :
`movement`, `angularmovement`, `alphafade`, `sizechange`, `alphachange`, `colorchange`, `turbulence`,
`vortex`/`vortex_v2`, `controlpointattract`, `oscillatealpha`, `oscillatesize`, `oscillateposition`.

**Renderer (`parseParticleRenderer`, `ObjectParser.cpp:761-785`) — faits :** `name` (sprite/rope/ropetrail/
spritetrail), `length`, `maxlength`, `minlength`, `subdivision`, `segments`, `uvscale`, `uvscrolling`,
`uvsmoothing`, `fadealpha`, `fadesize`.

**Control point (`parseParticleControlPoint`, `ObjectParser.cpp:787-813`) — faits :** `id`, `flags`
(bit 0 = linkMouse, bit 1 = worldSpace), `offset` (string `"x y z"` ou vec3), `locktopointer`.

**Child (`parseParticleChild`, `ObjectParser.cpp:815-865`) — faits :** `type` (static/…), `name`,
`maxcount`, `controlpointstartindex`, `probability`, `angles`, `origin`, `scale`, `particle` (fichier
référencé → système enfant).

**Instance override (`parseParticleInstanceOverride`, `ObjectParser.cpp:867-879`) — faits :**
`enabled`, `alpha`, `size`, `lifetime`, `rate`, `speed`, `count`, `color`, `colorn` (tous `UserSetting`).

### 1.2 Émission (`CParticle::createBoxEmitter` / `createSphereEmitter`, `CParticle.cpp:351-668`)

**Faits (box, `createBoxEmitter` 370-520) :**
- `rate` effectif = `emitter.rate * instanceOverride.rate` (`CParticle.cpp:371`).
- L'origine de l'émetteur subit une inversion Y : `transformedEmitterOrigin.y = -emitter.origin.y`
  (`CParticle.cpp:373-374`). Les directions aussi : `flippedDirections.y = -directions.y` (384-385).
- Sélection auto du control point 0 si `controlPoint==-1` et `cp0.flags & 1` (linkMouse) (`376-382`).
- `flags & 2` → `limitOnePerFrame` (1 émis max par frame) (`387`).
- `flags & 4` → `randomPeriodicEmission` : cycle delay/duration aléatoire entre
  `minPeriodicDelay..maxPeriodicDelay` et `minPeriodicDuration..maxPeriodicDuration` (`388`, 413-437).
- `emitter.instantaneous` → émission en une fois à la première frame (`443-446`).
- Émission par rate : `emissionTimer += dt*rate ; toEmit = floor(emissionTimer)` ; cap à 1 si
  `limitOnePerFrame` (`449-458`).
- Position : pour chaque axe, `dist` dans `[distanceMin, distanceMax]`, signe aléatoire ±
  (`472-483`), multiplié par `flippedDirections` (`483`). `p.position = spawnOrigin + randomPos` (`485`).
- **Le spawn n'applique PAS de vélocité** — les initializers s'en chargent (`487-491`).
- Valeurs initiales : `color = vec3(1)*colorn`, `alpha = 1*alphaOverride`, `size = 20*sizeOverride`,
  `lifetime = 1*lifetimeOverride`, `frame = -1`, copie dans `initial.*` (`494-505`).

**Faits (sphere, `createSphereEmitter` 522-668) :**
- `rate` effectif = `rate * instanceOverride.rate` (`523`) ; `lifetime` = `1*lifetimeOverride` (`524`).
- Inversion Y de l'origine (`527-528`), sélection auto CP0 linkMouse (`530-538`), `limitOnePerFrame`
  (`540`).
- `flags & 4` (particle.flags, persp.) : coquille 3D ; sinon disque 2D XY (`578-612`).
  Répartition uniforme : racine carrée (disque) / racine cubique (volume) (`586-608`).
- `sign[i]` : force positif/négatif par axe (`614-623`).
- Vélocité : si `speedMax>0 || speedMin!=0`, direction = `normalize(randomPos)` * `rand(speedMin,speedMax)`
  (`627-636`). Sinon vélocité laissée aux initializers.
- Émission : rate + `instantaneous` (`550-562`), valeurs initiales comme box (`643-666`).

### 1.3 Initializers (`CParticle.cpp:670-967`)

**Faits :**
- `colorrandom` : `color = randomVec3(min,max) * colorn` (`712-722`).
- `sizerandom` : `size = (min + pow(t,exponent)*(max-min)) * sizeOverride/2` (`724-741`). **Note /2.0**
  par rapport au max brut.
- `alpharandom` : `alpha = rand(min,max) * alphaOverride` (`743-753`).
- `lifetimerandom` : `lifetime = rand(min,max) * lifetimeOverride` ; mémorise `m_uniformLifetimes` si
  min==max (`755-765`).
- `velocityrandom` : `vel = randomVec3(min,max) * speedOverride ; vel.y = -vel.y ; p.velocity += vel`
  (`767-778`). **Inversion Y de la vélocité.**
- `rotationrandom` : `rotation = randomVec3(min,max) * speedOverride` (`780-789`).
- `angularvelocityrandom` : avec `exponent` (biais min/max) (`791-815`).
- `turbulentvelocityrandom` (`817-917`) : **Inversion Y de forward/right** (`835-836`) ; direction depuis
  `curlNoise` (`NoiseUtils`), normalisée, contrainte par `scale` (angle max), rotation par `offset`
  autour de `right`, projection XY si persp. désactivé (`904-910`), `p.velocity += result*speed*speedOverride`.
- `mapsequencearoundcontrolpoint` (`919-967`) : répartit les vitesses sur un cercle (indice de séquence
  partagé), **inversion Y de speed** (`955-956`) puis rotation par matrice 2D (`959-965`).

### 1.4 Operators (`CParticle.cpp:969-1637`)

**Faits :**
- `movement` (`1013-1051`) : `gravity.y = -gravity.y` (inversion Y, `1026`) ; intégration
  `position += velocity*dt` (`1036`) ; `velocity += gravity*dt*speed` (`1040`) ; drag
  `velocity *= (1 - drag*dt)` clampé ≥0 (`1043-1048`).
- `angularmovement` (`1053-1100`) : `rotation += angularVelocity*dt*speed` ; `angularVelocity += force*dt*speed`
  ; drag ; wrap dans [-π,π] (`1087-1097`).
- `alphafade` (`1102-1135`) : fade in/out via `fadeValue(life, fadeIn, 1, 0,1)` ; base mise à jour pour
  oscillation.
- `sizechange` (`1137-1166`), `alphachange` (`1168-1197`), `colorchange` (`1199-1230`) : interpolation
  `fadeValue(life, start, end, startVal, endVal)` multipliée par valeur initiale.
- `turbulence` (`1232-1288`) : `curlNoise(position + phase + timeScale*currentTime)` multiplié par
  `mask`, `p.velocity += curlDir*dt*speed` ; **pas d'inversion Y explicite** (le bruit est 3D, mask par
  défaut (1,1,0)). Phase/speed randomisés une fois par operator.
- `vortex` / `vortex_v2` (`1290-1447`) : centre = control point + offset ; axe normalisé (défaut Z) ;
  modes standard (distanceInner/Outer) ou annulaire (`ringShape`, flags&4) ; vitesse tangentielle
  `speed*dt*speedOverride`, force radiale, `centerforce` si `maintainDistance` (flags&2), `infiniteAxis`
  (flags&1) = projection cylindrique.
- `controlpointattract` (`1449-1494`) : attraction constante vers CP dans `threshold/2`.
- `oscillatealpha` / `oscillatesize` (`1496-1582`) : `cos(w*t+phase)` entre scaleMin/scaleMax, base
  capturée.
- `oscillateposition` (`1584-1637`) : dérive par `-scale*w*sin(w*t+phase)*dt * mask * speedOverride` par
  axe.

### 1.5 Intégration du mouvement & coordonnées / inversion Y

**Faits (central pour la question orientation) :**
- Origine objet : `origin.x -= W/2 ; origin.y = H/2 - origin.y` → passage espace écran (0,0 en haut-gauche)
  vers espace centré (0,0 au centre, Y vers le haut) (`CParticle.cpp:367-370` dans `setup`, et `426-431`
  dans `update` au changement de résolution).
- Émetteurs : `emitter.origin.y = -emitter.origin.y`, `directions.y = -directions.y` (`373-385`, `527-528`).
- Initializers : `velocityrandom` et `turbulentvelocityrandom` et `mapsequencearoundcontrolpoint`
  inversent Y (`775`, `835-836`, `955-956`).
- Operator `movement` : `gravity.y = -gravity.y` (`1026`).
- Donc **tout le pipeline de particules Linux travaille en espace centré Y-up**, avec des inversions Y
  systématiques à la lecture des données d'origine (qui sont Y-down dans le format WE). Le flip n'est
  **jamais** fait à l'upload texture (cf. rapport EffectRenderer : `CTexture.cpp` upload brut), il est
  porté par la géométrie/transforms.
- Control points : position calculée en espace local particule (`cp.offset - m_transformedOrigin` pour
  worldSpace, `CParticle.cpp:393-402`) ; mouse-linked converti depuis normalisé [0,1] avec
  `y = H/2 - mouseY*H` (`454-464`).

### 1.6 Spritesheets & frames (`CParticle.cpp:284-320`, `1984-1996`, `1911-1942`)

**Faits :**
- `m_spritesheetCols/Rows/Frames/Duration` lus depuis la texture (`TextureProvider::getSpritesheet*`)
  dans `setup` (`CParticle.cpp:200-209`).
- Calcul de `p.frame` (`update`, `298-319`) selon `animationMode` :
  - `randomframe` : frame aléatoire stable par particule (`299-309`).
  - `once` : `min(lifePos*frames*multiplier, frames-1)` (`310-313`).
  - sinon : si `spritesheetDuration>0` cycle temporel `fmod(age*mult, dur)/dur*frames` ; sinon
    `fmod(lifePos*frames*mult, frames)` (`314-319`).
- `sequenceMultiplier` multiplie la vitesse d'anim (`297`).
- Encoding pour le shader (`renderSprites`, `1979-1996`) : `lifetime` du vertex = `frame/frames`
  (ou `(frame+0.5)/frames` pour randomframe) ; le shader `genericparticle` reconstruit
  `floor(lifetime*numFrames)` et `frac(...)` pour blending inter-frames.
- `updateParticleRenderVars` (`1911-1942`) : `g_RenderVar1` = (frameW, frameH, frames, textureRatio) ;
  `textureRatio = (atlasH*frameH)/(atlasW*frameW)` en spritesheet, sinon `h/w` (`1914-1941`).

### 1.7 Matrices (`CParticle.cpp:1828-1909`)

**Faits :**
- `updateMatrices` (`1828-1854`) : `m_modelMatrix = translate(transformedOrigin)` → parallaxe →
  rotations avec **inversion X/Z** : `rotate(-angles.z, Z)`, `rotate(angles.y, Y)`, `rotate(-angles.x, X)`
  (`1837-1839`) → `scale` → inverse.
- `m_mvpMatrix = viewProjection * modelMatrix` ; `m_mvpMatrixInverse = inverse(mvp)` (`1843-1845`).
- `m_viewProjectionMatrix` : persp. si `flags&4` (`perspective * lookAt(0,0,1000 → 0,0,0, up=Y)`),
  sinon `camera.getProjection()*camera.getLookAt()` (ortho centré) (`1882-1909`).
- Uniforms supplémentaires (`setupParticleUniforms`, `1809-1826`) : `g_ModelMatrixInverse`,
  `g_OrientationUp/Right/Forward`, `g_ViewUp/Right`, `g_EyePosition` (0,0,1000), `g_RenderVar0/1`,
  et `g_RefractAmount` si REFRACT.
- Ces pointeurs sont passés à `CPass` via `setModelViewProjectionMatrix` etc. (`setupPass`,
  `1694-1698`) → **CPass déréférence les matrices chaque frame** (contrairement à Komorebi qui les
  neutralise).

### 1.8 Rendu & blending (`CParticle.cpp:1641-2096`, `CPass`)

**Faits :**
- `setupPass` (`1641-1693`) : construit `ImageEffectPassOverride` avec combos THICKFORMAT/SPRITESHEET/
  TRAILRENDERER, `shaderOverride` rope si besoin, `m_passBinds = {0: "previous"}` (force texture0 =
  l'input particule, `1664`), détecte `REFRACT` combo (`1667-1668`), crée un FBO provider + FBO copie
  (`_rt_FullFrameBuffer`) si REFRACT (`1672-1685`), instancie `CPass` (`1688`), `setDestination(sceneFBO)`,
  `setInput(texture)`.
- Vertex layout sprite (17 floats/vert, `1756-1787`) : `a_Position(3)`, `a_TexCoordVec4(uv.x,uv.y,rotZ,size)`,
  `a_Color(rgba)`, `a_TexCoordVec4C1(vel.xyz, lifetime)`, `a_TexCoordC2(rotX,rotY)`.
- Vertex layout rope (26 floats/vert, `1714-1755`) : `a_PositionVec4`, `a_TexCoordVec4`, `a_TexCoordVec4C1`,
  `a_TexCoordVec4C2`, `a_TexCoordVec4C3`, `a_TexCoordC4`, `a_Color`.
- `renderSprites` (`1944-2096`) : construit les quads (UV 0..1, `2027-2030`), upload VBO/EBO dynamique,
  `updateMatrices`, blit REFRACT, `glEnable(GL_DEPTH_CLAMP)` puis `m_pass->render()` (`2086-2091`).
  Blending géré par `CPass::setupRenderFramebuffer` (Translucent/Additive/Normal/None selon
  `pass.blending` — cf. rapport EffectRenderer §16). **Komorebi force toujours SRC_ALPHA/ONE_MINUS_SRC_ALPHA.**
- `renderRope` (`2098-2323`) : spline Catmull-Rom subdivisée (`subdivision`), quads ruban, UV par
  arc-length ou index, scrolling, smoothing si `m_uniformLifetimes && !uvScrolling`.

### 1.9 NoiseUtils (`NoiseUtils.h`, fichier unique, pas de .cpp)

**Faits :** Perlin 3D (`perlinNoise`, table `PERLIN_PERM` dupliquée pour wrap), `perlinNoiseVec3`
(offsets 89.2/33.1/57.3, 100.3/120.1/142.2), `curlNoise` (différences finies `e=1e-4`,
`(y1.z-y0.z)-(z1.y-z0.y)`, etc.). Aucune autre dépendance. Utilisé par `turbulentvelocityrandom` et
`turbulence`.

---

## 2. Implémentation Komorebi (faits extraits de `ParticleRenderer.ts`, `SceneModel.ts`, `SceneLoader.ts`)

### 2.1 `SceneModel.createParticles` (`SceneModel.ts:168-265`)

**Faits :** pour chaque objet `object.particle` visible, lit le JSON de particule + material, prend
`passes[0].textures[0]` comme texture, et extrait **uniquement** :
- `lifetimerandom` (range), `sizerandom` (range), `velocityrandom` (vectorRange), `movement.gravity`,
  `alphafade.fadeintime/fadeouttime`, `turbulentvelocityrandom` (offset/scale/speedmin/max),
  `emitter[0]` (name/distancemin/max/origin).
- `override.colorn`, `override.alpha/lifetime/size/rate`, `object.origin/scale/angles(maxcount)`.
- `count = clamp(round(maxcount * override.rate), 1, 1024)` (`226-234`).
- `animationMode` transmis.
- Construit un `ParticleSystem` plat (plusieurs champs `range`/`vectorRange`).

**Fonctionnalités LINUX présentes dans le parse JSON mais NON lues par Komorebi (faits sur le parsing) :**
- `colorrandom`, `alpharandom`, `rotationrandom`, `angularvelocityrandom`,
  `mapsequencearoundcontrolpoint` (initializers ignorés → valeurs par défaut silencieuses).
- `angularmovement`, `sizechange`, `alphachange`, `colorchange`, `turbulence[vortex]`, `vortex`,
  `controlpointattract`, `oscillatealpha/size/position` (operators ignorés).
- `controlpoint[]`, `children[]`, `flags`, `sign`, `delay`, `duration`, `instantaneous`,
  `min/maxperiodic*`, `cone`, `audioProcessing*`.
- `renderer[]` (rope/ropetrail/spritetrail) — **totalement ignoré** : Komorebi ne fait que des point
  sprites.
- `material.passes[0].constants` (`ui_editor_properties_overbright`), `combos` (`REFRACT`, `SPRITESHEET`,
  `TRAILRENDERER`, `THICKFORMAT`) — ignorés.

### 2.2 `ParticleRenderer.draw` / `#particleVertices` (`ParticleRenderer.ts:41-262`)

**Faits (rendu) :**
- Un seul programme (`PARTICLE_VERTEX_SHADER`/`PARTICLE_FRAGMENT_SHADER` maison), `drawArrays(POINTS, …)`
  (`ParticleRenderer.ts:94`). **Aucun CPass, aucun FBO, aucune matrice MVP, aucune perspective.**
- Uniforms : `uProjection` (vec2), `uSceneScale` (vec2), `uPixelScale` (height/proj.y*sceneScale.y),
  `uTexture` (`ParticleRenderer.ts:50-93`).
- Par particule : `particles[4] = (x, y, size*scale, alpha*fade)`, `colors[3]`, `rotations[1]`,
  `textureRects[4]` (rect spritesheet) (`106-173`).
- Position CPU (`#particleVertices`, `133-146`) :
  `x = origin.x + emitterOrigin.x + offset.x + velocityX*age + gravity.x*age²*0.5 + turbulence.x`
  `y = origin.y + emitterOrigin.y + offset.y + velocityY*age + gravity.y*age²*0.5 + turbulence.y`.
- `turbulence` (`#turbulence`, `199-216`) : **2D uniquement** `sin(phase)*scale`, `cos(phase*0.73)*scale`
  avec `phase = age*speed + offset + rand*2π`. **Aucun bruit de Perlin/curl** (contrairement à
  `NoiseUtils::curlNoise`).
- `#particleOffset` (`218-228`) : box → lerp dans [min,max] par axe ; sphere → disque `cos/sin*dist`.
  **Pas de coquille 3D, pas de sign, pas de periodic emission, pas d'instantaneous, pas de control point.**
- `#textureRect` (`175-197`) : spritesheet via `currentFrame(frames, age*1000, 0)` ou randomframe ;
  sinon `u/v` du système.
- `#random` (`246-249`) : **déterministe** `sin(seed*12.9898)*43758.5453` fract — pas un vrai RNG
  (Linux utilise `std::mt19937` seedé aléatoirement). L'âge de chaque particule est
  `(elapsed + seed*lifetime) % lifetime` (`ParticleRenderer.ts:122`) — modèle "toutes vivantes en boucle",
  pas de pool avec émission rate/durée/delay.

### 2.3 `ParticleVertexShader.ts` / `ParticleFragmentShader.ts`

**Faits :**
- Vertex : `clipPosition = (x/uProjection.x*2-1, 1 - y/uProjection.y*2)` ; `gl_PointSize = max(1, z*uPixelScale)`
  (`ParticleVertexShader.ts:14-20`). **Inversion Y à l'écran** (`1 - ...`), espace écran haut-gauche.
- Fragment : `point = (gl_PointCoord.x, 1 - gl_PointCoord.y) - 0.5` ; rotation 2D ;
  `texture2D(uTexture, vTexRect.xy + point*vTexRect.zw)` ; `rgb *= vColor ; a *= vAlpha`
  (`ParticleFragmentShader.ts:9-18`). **Blending hardcodé SRC_ALPHA/ONE_MINUS_SRC_ALPHA**
  (`ParticleRenderer.ts:64`).

### 2.4 `SceneLoader` (`SceneLoader.ts`)

**Faits :** `prepareParticles` (`165-178`) upload la texture (image ou video) et attache `glTexture`.
Aucune création de FBO, aucun material/pass/combos, aucun CPass. Les particules sont rendues **après**
les layers (cf. `RenderPipeline` du rapport EffectRenderer), indépendamment du graphe d'effets.

---

## 3. Comparaison — faits vs faits

| Comportement (Linux, preuve) | Komorebi (preuve) | Différence constatée |
|---|---|---|
| Pool de N particules, émission par `rate`*`override.rate`, `delay`/`duration`/`instantaneous`/`periodic` (`CParticle.cpp:351-668`) | `count` particules toujours vivantes en boucle, âge `(elapsed+seed*lifetime)%lifetime` (`ParticleRenderer.ts:119-123`) | Pas de modèle d'émission temporel ; pas de delay/duration/instantaneous/periodic |
| 2 types émetteurs box/sphere, coquille 3D si `flags&4`, `sign`, control point auto (`370-668`) | box (lerp par axe) / sphere (disque 2D) seulement (`#particleOffset` 218-228) | Pas de coquille 3D, pas de sign, pas de sélection CP |
| 9 initializers dont color/alpha/rotation/angularvelocity/mapsequence/turbulent (`625-967`) | 3 lus (lifetime/size/velocity) + turbVal partielle + colorrandom via override.colorn ; rotation/angularvelocity lus mais appliqués seulement comme constantes (`SceneModel.ts:194-262`) | colorrandom/alpharandom/rotationrandom/angularvelocityrandom/mapsequence**non simulés** (valeur constante par système, pas par particule) |
| 12 operators dont alphafade/sizechange/alphachange/colorchange/turbulence/vortex/controlpointattract/oscillate* (`969-1637`) | alphafade (fadeIn/Out seulement), turbulence 2D simplifiée (`199-216`) ; **aucun** sizechange/alphachange/colorchange/vortex/controlpointattract/oscillate | La plupart des operators absents |
| Intégration `position += velocity*dt`, `velocity += gravity*dt*speed` avec `gravity.y=-gravity.y` (`1013-1051`) | `x += velocityX*age + gravity.x*age²*0.5` (intégration **quadratique** en age, pas vélocité intégrée) (`133-146`) | Modèle physique différent : Linux intègre la vélocité par dt ; Komorebi suppose accélération constante et intègre en age²/2 (valide seulement si velocity=0 initialement, ce qui n'est pas le cas) |
| `NoiseUtils::curlNoise` 3D Perlin (`NoiseUtils.h`) | `sin/cos` 2D déterministe (`#turbulence` 199-216) | Bruit totalement différent |
| Spritesheet via `g_RenderVar1`, frame blending inter-images, `sequenceMultiplier`, `animationMode` once/randomframe/sequence (`284-320`, `1911-1942`, `1979-1996`) | `currentFrame(frames, age*1000)` ou randomframe ; `sequenceMultiplier` **non lu** ; `once` non géré (`#textureRect` 175-197) | Modes d'anim manquants (once), vitesse d'anim ignorée |
| Matrices MVP/perspective/ortho, `g_ModelMatrixInverse`, orientations, eye (`1828-1909`, `1809-1826`) | Aucune matrice ; projection écran via `uProjection`/`uSceneScale` dans le vertex shader (`ParticleVertexShader.ts`) | Pas de perspective, pas de rotation 3D, pas de parallaxe appliquée aux particules |
| Renderers `sprite`/`rope`/`ropetrail`/`spritetrail` → `genericparticle`/`genericropeparticle` + combos (`1641-1693`) | Uniquement point sprites ; `renderer[]` ignoré (`SceneModel.ts:168`) | Rope/trail indisponibles |
| Blending selon `pass.blending` (Translucent/Additive/Normal) via CPass (`CPass::setupRenderFramebuffer`) | Blending hardcodé SRC_ALPHA/ONE_MINUS_SRC_ALPHA (`ParticleRenderer.ts:64`) | Additive (overbright) impossible ; REFRACT impossible |
| Control points (max 8, linkMouse/worldSpace, enfant) (`CParticle.cpp:393-464`, `787-813`, `815-865`) | Absents | Aucun |
| REFRACT : copie FBO scène + `g_RefractAmount` (`1667-1685`, `2069-2079`) | Absent | Inexistant |
| `overbright` depuis `ui_editor_properties_overbright` (`setup` 200-209) | Absent | Inexistant |
| RNG `std::mt19937` seedé ; par-particule aléatoire | `#random = sin(seed)*43758 fract` déterministe (`246-249`) | Hasard non conforme (pas d'aléa réel, seed déterministe) |

---

## 4. Logique Komorebi SANS équivalent démontré dans Linux

**Aucune** logique Komorebi n'est en contradiction avec Linux ; elle est un **sous-ensemble** différent.
Points à signaler où Komorebi fait quelque chose que Linux ne fait pas de la même manière (donc pas un
"équivalent démontré") :
- Modèle "toutes les particules toujours vivantes, âge décalé par seed" (`ParticleRenderer.ts:122`) —
  Linux a un pool avec émission et compaction (`CParticle::update` 313-321). Ce n'est pas une
  "fonctionnalité en plus", c'est une **approximation du comportement** ; elle diverge pour delay/
  duration/instantaneous/periodic et pour le comptage réel émis par frame.
- Intégration `gravity*age²*0.5` (`ParticleRenderer.ts:138,145`) — Linux intègre `velocity += gravity*dt`
  puis `position += velocity*dt` (`CParticle.cpp:1036,1040`). La forme quadratique de Komorebi n'est
  correcte que si velocity initiale = 0, ce que Linux n'impose pas.
- `#random` déterministe par seed (`ParticleRenderer.ts:246-249`) — Linux utilise un vrai RNG seedé.
  L'absence de vraie stochasticité n'a pas d'équivalent Linux et produit un rendu trop régulier.

---

## 5. Réponses ciblées (faits / absent / incertain)

### Émission (rate, délais, durée, flags)
- **Faits** : `createBoxEmitter`/`createSphereEmitter` (`CParticle.cpp:351-668`). Rate = `emitter.rate *
  instanceOverride.rate` ; `emissionTimer += dt*rate` ; `instantaneous` une fois ; `delay` avant
  émission ; `duration` borne temporelle ; `flags&2` = 1/frame ; `flags&4` = émission périodique
  aléatoire (delay/duration aléatoires). Tout est dans `setup`/`update`.
- **Absent Komorebi** : delay, duration, instantaneous, periodic, flags complexes.
- **Incertain** : valeurs exactes de某些 défauts WE (cone) non vérifiées car `parseParticleEmitter`
  les lit (`ObjectParser.cpp:605`) mais elles ne sont pas utilisées dans les émetteurs visibles
  (possible TODO ou utilisées par un chemin shader).

### Initializers / Operators / intégration / turbulence / coordonnées Y
- **Faits** : voir §1.3, §1.4, §1.5. Inversion Y systématique à la lecture (origine, directions,
  velocity, gravity, forward/right, speed mapsequence). Espace de travail = centré Y-up.
- **Absent Komorebi** : tous sauf lifetimerandom/sizerandom/velocityrandom(partiel)/turbulentvelocityrandom
  (2D)/alphafade(partiel).
- **Incertain** : comportement exact de `turbulentvelocityrandom` (scale/offset/right/forward/phase)
  dépend du shader `genericparticle` non consultable ; les commentaires C++ (`817-917`) décrivent
  fidèlement l'algorithme CPU (curlNoise + contrainte d'angle), ce qui est un fait sur le CPU.

### Spritesheets / matrices / blending / rendu
- **Faits** : §1.6, §1.7, §1.8. Spritesheet via `g_RenderVar1` + frame encoding ; MVP/perspective/ortho ;
  blending par `pass.blending` ; REFRACT + overbright.
- **Absent Komorebi** : matrices, perspective, rope/trail, REFRACT, overbright, blending configurable,
  spritesheet `once`/vitesse.

### NoiseUtils
- **Fait** : Perlin 3D + curl 3D (`NoiseUtils.h`). Aucune autre dépendance. Utilisé par turbulence
  (operator + initializer turbulentvelocityrandom).
- **Absent Komorebi** : tout bruit ; remplacé par sin/cos 2D.

---

## 6. Diagnostic par fond d'écran (faits + incertitudes)

Données manquantes pour conclure : les `scene.json`/`particle` des 5 IDs. Les liens ci-dessous sont des
**hypothèses basées sur l'architecture**, à vérifier sur les fichiers réels.

- **1179701732 (pétales de roses absentes)** — *Hypothèse* : ce sont des particules (type `particle`).
  Komorebi les détecte (`SceneModel.createParticles`) mais avec l'approximation §2.1/§2.2. Cause probable
  d'absence : un renderer `rope`/`spritetrail` non géré, ou un initializer/operator clé non simulé
  (ex. `mapsequencearoundcontrolpoint`, `vortex`, `oscillate*`), ou `maxcount` élevé plafonné à 1024, ou
  émission `instantaneous`/périodique non déclenchée. **Incertitude haute** sans le `scene.json`.
  *Fait* : le chemin de rendu Komorebi ignore rope/trail/controlpoints/operators multiples.

- **3479521040 (non supporté, positionnement trop haut, images non animées)** — *Fait* : `SceneLoader.load`
  lève `"Scene texture format is not supported"` si `layers.length == 0` (`SceneLoader.ts:45-47`). Le
  "non supporté" vient d'objets image non résolus, pas des particules. "Trop haut" : la conversion
  d'origine Linux (`origin.y = H/2 - origin.y`) est faite dans `resolveLayerGeometry` (`SceneModel.ts:
387-417`) mais en espace centré ; si une couche est `fullscreen`, l'origine est forcée au centre
  (`398`). *Hypothèse* : divergence de convention Y entre image et particule. "Non animées" : les
  animationLayers/effets non gérés (cf. rapport EffectRenderer §G).

- **2703206776 (image verticalement inversée, fond devrait tourner mais immobile)** — *Fait* : Linux
  applique `angles` avec inversion X/Z (`CParticle.cpp:1837-1839`) et la rotation du fond est dans
  `m_mvpMatrix` (`1844`). Komorebi applique `rotation = angles[2]` dans `resolveLayerGeometry`
  (`SceneModel.ts:372,414`) mais **ne recalcule pas de MVP par frame** et ses shaders d'image n'appliquent
  pas la rotation dynamique (cf. rapport EffectRenderer §A/G). Image inversée = flip Y de la texture ou
  du quad (§E rapport EffectRenderer). Fond immobile = animation de transform non transmise.

- **3759507080 (scène ne se charge pas, 3 images + background à l'envers)** — *Fait* : échec de
  `SceneLoader.load` (exception ou layers vides). "À l'envers" = inversion Y systématique (cf. §E
  EffectRenderer). *Hypothèse* : certains objets sont des particules ou controls points dont le parsing
  échoue ou le rendu sort du cadre.

- **2111201226 (vague sur tout le corps de Rem, corps suspendu tête en bas)** — *Fait* : l'effet de vague
  est un `effect` d'image (cf. rapport EffectRenderer §F) ; les particules ne sont pas en cause ici.
  Corps tête en bas = flip Y de l'image de Rem (§E EffectRenderer). Vague sur tout le corps = masque
  d'effet étiré par résolution de texture unique + MVP identité (§A/§B/§F EffectRenderer). *Note* : ce cas
  ne relève **pas** du présent rapport particules ; il est couvert par le rapport EffectRenderer.

---

## 7. Informations encore manquantes (non comblées par supposition)

1. **Shaders `genericparticle` / `genericropeparticle` / `common_particles.h`** : non présents dans le
   dépôt sous forme lisible (transpilés depuis HLSL WE via SPIRV-Cross/glslang, sous-modules). Le layout
   d'attributs et les fonctions `ComputeSpriteFrame`/`ComputeParticleTrailTangents` sont **inférés** des
   commentaires C++ de `renderSprites`/`renderRope`, pas prouvés par le GLSL.
2. **`scene.json` / `particle` des 5 IDs** : nécessaires pour confirmer le type exact (particle vs image
   vs controlpoint) et les initializers/operators/renderer utilisés — surtout 1179701732 (pétales).
3. **`TextureProvider::getSpritesheet*`** et `CRenderable::detectTexture`/`getTexture`** : non lus ici
   (hors périmètre direct, mais nécessaires pour valider le path spritesheet Komorebi vs Linux).
4. **`CScene::getCamera().getProjection()/getLookAt()`** : valeurs exactes de l'ortho centrée utilisée
   pour les particules (confirmé centré Y-up par `setup` `367-370`, mais matrices caméra non lues).
5. **`ShaderUnit`/`GLSLContext`** : comment le HLSL WE devient du GLSL (pour valider que les attributs
   `a_PositionVec4` etc. correspondent bien au CPU layout de `CParticle`).

---

## 8. Synthèse des causes racines (architecture, pas par ID)

1. **Le renderer de particules Komorebi est une implémentation parallèle**, ne réutilisant ni `CPass`,
   ni les matrices MVP, ni les FBO, ni les materials/passes (§2 vs §1). Toute la richesse
   (rope/trail, control points, operators, REFRACT, overbright, perspective) en est exclue par conception.
2. **Modèle d'émission absent** : pas de rate/delay/duration/instantaneous/periodic (§3).
3. **Majorité des initializers/operators non simulés** (§3) → rendu statique ou trop régulier.
4. **Turbulence 2D sin/cos vs curlNoise 3D Perlin** (§1.9 vs §2.2).
5. **Aucune matrice / perspective / parallaxe** appliquée aux particules (§1.7 vs §2.3).
6. **Blending hardcodé** → additive/overbright impossible (§1.8 vs §2.3).
7. **RNG déterministe** vs `mt19937` seedé (§4).
8. **Convention Y** : Linux travaille en centré Y-up avec inversions à la lecture ; Komorebi mélange
   écran haut-gauche (particules, `ParticleVertexShader.ts:17`) et centré (images). Divergence documentée
   dans le rapport EffectRenderer §E.

Aucun correctif ni approximation n'est proposé. Les fichiers Linux cités : `CParticle.cpp` (lignes
référencées), `CParticle.h`, `ObjectParser.cpp` (286-879), `NoiseUtils.h`. Fichiers Komorebi :
`renderer/ParticleRenderer.ts`, `scene/SceneModel.ts` (168-265, 387-417, 505-537), `scene/SceneLoader.ts`
(45-47, 165-178), `graphics/shaders/ParticleVertexShader.ts`, `graphics/shaders/ParticleFragmentShader.ts`.
