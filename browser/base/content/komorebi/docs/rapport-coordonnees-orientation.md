# Analyse minutieuse : coordonnées et orientation (Linux vs Komorebi)

Référence : `Almamu/linux-wallpaperengine` (`CImage.cpp`, `CScene.cpp`, `Camera.cpp`).
Cible : `browser/base/content/komorebi/src/` (`SceneModel.ts`, `SceneVertexShader.ts`, `LayerRenderer.ts`,
`Geometry.ts`, `TextureUploader.ts`, `RenderPipeline.ts`, `ParticleRenderer.ts`, `ParticleVertexShader.ts`).

Objectif : identifier les divergences de convention qui produisent un **mauvais positionnement / mauvaise
orientation** des dessins (images, couches, particules) sur de nombreux fonds, dans le but d'un portage
fidèle. Aucun correctif proposé ; seulement faits, divergences, incertitudes.

---

## 1. Convention Linux (référence)

### 1.1 Espace de travail des objets
`CImage` (`CImage.cpp`, constructeur) calcule d'abord un rectangle `m_pos` en **espace écran** (origine
haut-gauche, Y vers le bas) :
- `m_pos.x = origin.x - scaledSize.x/2` ; `m_pos.z = origin.x + scaledSize.x/2`
- `m_pos.y = origin.y - scaledSize.y/2` ; `m_pos.w = origin.y + scaledSize.y/2` (`CImage.cpp:~200-205`)
- Gestion `alignment` **dans cet espace écran Y-bas** :
  - `top` → `m_pos.y -= scaledSize.y/2` et `m_pos.w -= scaledSize.y/2`
  - `bottom` → `+=`
  - `left`/`right` symétrique sur x (`CImage.cpp:~207-218`)
- **Conversion finale vers espace centré Y-up** (`CImage.cpp:~213-218`) :
  ```
  m_pos.x -= scene_width/2 ;
  m_pos.y  = scene_height/2 - m_pos.y ;
  m_pos.z -= scene_width/2 ;
  m_pos.w  = scene_height/2 - m_pos.w ;
  ```
- Le quad de sommets `sceneSpacePosition` est donc exprimé en **centré Y-up** (`CImage.cpp:~228+`).

### 1.2 Projection caméra
`CScene::CScene` (`CScene.cpp:~60-75`) : si `camera.projection.isAuto`, la taille de projection est
calculée depuis les extents des objets (`maxExtent = max(|origin|+halfSize)`) puis `width=2*maxExtent.x`,
`height=2*maxExtent.y` ; sinon depuis `camera.projection.width/height`. Puis
`m_camera->setOrthogonalProjection(width, height)` → projection **orthogonale centrée** (0 au centre).
`CScene::getWidth/Height` renvoie `camera.getWidth/Height`.

### 1.3 Rotation
`updateScreenSpacePosition` (`CImage.cpp:~250-280`) :
- `rotModel = translate(center) * rotate(-angle, Z) * translate(-center)` (angle en radians ;
  **`-angle`** car l'espace est Y-up après flip, commentaire référence `CParticle.cpp:2120`).
- `mvp = camera.getProjection() * camera.getLookAt() * rotModel`.
- La rotation s'effectue **autour du centre du quad** (`m_sceneCenter`), en espace centré Y-up.

### 1.4 Parallaxe
Appliquée comme une translation supplémentaire sur le MVP (`CImage.cpp:~258-268`), pilotée par
`camera.parallax` et `parallaxDepth`. (Hors périmètre direct de cette analyse, mais la convention
d'espace centré s'applique.)

### 1.5 Upload texture
`CTexture` / `CFBO` uploadent les pixels **bruts** (pas de flip Y à l'upload). L'orientation finale de
l'image est portée par la géométrie/UV, pas par l'upload.

---

## 2. Convention Komorebi (cible)

### 2.1 Espace de stockage de `origin`
`SceneModel.resolveLayerGeometry` (`SceneModel.ts:443-473`) :
- `transform = resolveTransform(object)` → `localTransform` lit `object.origin` **brut** (`512`), donc
  `layer.origin` est stocké en coordonnées **centrées Y-up** (car `fullscreen` force
  `[W/2, H/2]` en `443-455`, ce qui est bien le centre en espace centré).
- **Alignment appliqué dans l'espace centré Y-up** (`459-468`) :
  - `top` → `origin[1] -= scaledHeight/2` (dans Y-up centré, soustraire = **descendre**)
  - `bottom` → `origin[1] += scaledHeight/2` (monter)
  - `left`/`right` sur x.
- Donc `layer.origin` est **centré Y-up**.

### 2.2 Shader de couche
`SceneVertexShader` (`SceneVertexShader.ts:11-24`) :
```
localPosition = aPosition * uSize ;
worldPosition = uOrigin + rotate(localPosition, uRotation) ;  // rotate sans inversion
clipPosition.x = worldPosition.x / uProjection.x * 2.0 - 1.0 ;
clipPosition.y = 1.0 - worldPosition.y / uProjection.y * 2.0 ;   // <- FORMULE ÉCRAN Y-BAS
```
- La formule `1.0 - y/H*2.0` suppose que `worldPosition.y` est en **espace écran haut-gauche (Y bas)**.
- `uOrigin` est traité comme une coordonnée écran Y-bas.

### 2.3 Ce qui est envoyé au shader
`LayerRenderer.draw` (`LayerRenderer.ts:49-62`) :
- `uOrigin = layer.origin` → **centré Y-up** (cf. §2.1).
- `uRotation = -layer.rotation - transformAngle` (`61`) → angle **déjà inversé** côté Komorebi.
- `uSize = layer.size * layer.scale * (transformScale si mode=1)` (`54-58`).

### 2.4 Quad / UV
`Geometry.QUAD_VERTICES` (`Geometry.ts:1-9`) : `aPosition` = (-0.5,-0.5),(0.5,-0.5),(-0.5,0.5),(0.5,0.5) —
centré en 0, Y-up local. `LayerRenderer` construit les UV via le buffer `aTexCoord` à la volée
(`LayerRenderer.ts:74-80`) : `(left,top),(right,top),(left,bottom),...` avec `top/bottom` issus de
`frame.top/frame.bottom` (défaut 0 / `layer.v`). Donc UV.v=0 en bas du quad local.
`FULLSCREEN_UVS` (`Geometry.ts:21-29`) : (0,1),(1,1),(0,0),... → v=1 en haut du quad.

### 2.5 Upload texture
`TextureUploader.upload` (`TextureUploader.ts:10-66`) : **aucun `UNPACK_FLIP_Y_WEBGL`** (seulement
`UNPACK_ALIGNMENT=1`, ligne 20). Pixels uploadés **bruts** (ligne du haut de l'image = v=0). Cohérent
avec Linux sur ce point (pas de flip à l'upload).

### 2.6 Particules (rappel du rapport précédent)
`ParticleVertexShader` (`ParticleVertexShader.ts:14-19`) : `clip = (x/uProj.x*2, y/uProj.y*2)` — **sans**
le `1 - ...`. `ParticleRenderer.#vertices` place `x = origin[0]-W/2 + pos.x*scale`,
`y = H/2 - origin[1] + pos.y*scale` (`ParticleRenderer.ts:314-321`) → espace **centré Y-up**. Donc les
particules utilisent une convention **différente** des couches (qui utilisent `1 - y/H*2`).

---

## 3. Divergences constatées (faits)

### D1 — Inversion Y systématique des couches (critique)
Linux : quad en **centré Y-up**, MVP ortho centrée → clip Y-up correct. Origine scène = centrée.
Komorebi : `layer.origin` est **centré Y-up** (§2.1) MAIS le shader applique `clip.y = 1 - y/H*2`
(`SceneVertexShader.ts:21`), formule valide seulement pour un `worldPosition` en **espace écran Y-bas**.
Conséquence mathématique : si `origin.y` centré = +H/2 (haut en Y-up), `clip.y = 1 - 1 = 0` (milieu écran,
pas le haut) ; si `origin.y = -H/2` (bas), `clip.y = 1 - (-1) = 2` (hors écran). Le mapping est donc
**faux** : une couche centrée Y-up avec cette formule est inversée et mal positionnée verticalement
par rapport à la référence.

Pour reproduire Linux, le shader de couche devrait utiliser `clip.y = worldPosition.y/uProjection.y*2.0`
(sans `1 -`), puisque `layer.origin` est déjà centré Y-up. À noter : cette inversion simple ne suffit pas
seule (voir D2/D3).

### D2 — Alignment inversé
Linux applique `alignment` en **espace écran Y-bas** avant conversion (soustraire pour "top" = monter).
Komorebi l'applique en **espace centré Y-up** en soustrayant pour "top" (`SceneModel.ts:459-460`), ce qui
fait **descendre** la couche. Résultat : une couche `alignment: top` apparaît en bas côté Komorebi, et
réciproquement. Divergence de signe sur l'axe Y pour l'alignment.

### D3 — Cohérence rotation vs espace
Linux : `-angle` dans `rotModel` (espace centré Y-up), rotation autour du centre.
Komorebi : `-layer.rotation` envoyé au shader (`LayerRenderer.ts:61`), mais le shader tourne dans un
espace traité comme écran Y-bas (`1 - y/H*2`). Combiné à D1, le **sens visuel** de rotation peut finir
inversé par rapport à la référence (une rotation horaire Linux apparaissant anti-horaire, ou l'inverse),
selon la correction retenue pour D1. Le signe de `uRotation` doit être revu conjointement avec D1.

### D4 — Conventions d'espace hétérogènes dans le projet
- Couches (`SceneVertexShader`) : formule écran Y-bas (`1 - y/H*2`).
- Particules (`ParticleVertexShader`) : formule centré Y-up (sans `1 -`).
- Effets / `FULLSCREEN_UVS` : v=1 en haut du quad.
Le projet mélange deux conventions d'axe Y selon le composant. Un portage fidèle exige une convention
unique (centrée Y-up, comme Linux) partagée par tous les shaders.

### D5 — UV vs pixels (orientation image)
`TextureUploader` n'applique pas `UNPACK_FLIP_Y_WEBGL` : la première ligne de l'image (haut visuel) est en
v=0. Avec `FULLSCREEN_UVS` v=1 en haut du quad et `SceneVertexShader` `1 - y/H*2`, il faut vérifier que le
haut de l'image arrive en haut de l'écran. La combinaison actuelle (UV v=1 en haut + géométrie inversée)
peut **double-inverser** ou **annuler** le flip attendu, produisant des images à l'envers selon le chemin
(couche simple vs effet). C'est la cause probable des cas « image verticalement inversée » / « à l'envers ».

### D6 — Projection auto non implémentée
Linux calcule la taille de projection depuis les extents des objets si `isAuto` (`CScene.cpp:~62-75`).
Komorebi reçoit `projection` depuis le contexte (`RenderPipeline.render(projection,…)`) — la source de
cette projection (auto vs `camera.projection`) n'est pas dans les fichiers lus ici ; **incertitude** sur
l'égalité des dimensions entre les deux moteurs. Si la projection Komorebi diffère de celle de Linux
(notamment en mode auto), tous les positionnements par origine sont décalés proportionnellement.

### D7 — Parallaxe partielle / absente
Linux applique la parallaxe comme translation sur le MVP (`CImage.cpp:~258-268`). Komorebi : aucune
parallaxe visible dans `LayerRenderer`/`SceneVertexShader` (les uniforms de parallaxe ne sont pas
présents). Les fonds utilisant `camera.parallax` auront les couches mal positionnées par rapport à la
souris / au depth. **Incertitude** : à confirmer que la parallaxe n'est pas gérée ailleurs.

---

## 4. Fonds impactés (hypothèses d'architecture, à confirmer sur scene.json)

Les symptômes des 5 IDs cibles s'expliquent directement par D1–D5 :

- **2703206776 (image verticalement inversée ; fond devrait tourner mais immobile)** — *Fait* : D1
  (inversion Y des couches) + D5 (UV vs géométrie) produisent l'image retournée. « Immobile » =
  animation de transform (rotation) non transmise ou neutralisée (cf. rapport EffectRenderer §A/G) ;
  ici `layer.rotation` est bien envoyé (`LayerRenderer.ts:61`) mais l'espace inversé (D1/D3) fausse le
  rendu. *Hypothèse* : la rotation du fond est portée par `angles` et devrait tourner via le MVP
  (Linux `updateScreenSpacePosition`) ; côté Komorebi elle dépend de `uRotation` dont le signe est à
  revoir (D3).
- **3479521040 (non supporté ; positionnement trop haut ; certaines images non animées)** — *Fait* :
  `SceneLoader.load` lève si `layers.length==0` (`SceneLoader.ts:45-47`) → le « non supporté » vient
  d'objets image non résolus, indépendant de l'orientation. « Trop haut » = D1 (origine centrée Y-up
  interprétée en Y-bas par le shader) décale verticalement. *Hypothèse* : couches avec `origin.y` élevé
  sortent par le haut.
- **3759507080 (scène ne se charge pas ; 3 images + background à l'envers)** — *Fait* : échec de
  `SceneLoader.load`. « À l'envers » = D1/D5 (inversion globale de l'axe Y). *Hypothèse* : l'orientation
  systématique touche toutes les couches de ce fond.
- **2111201226 (vague sur tout le corps de Rem ; corps suspendu tête en bas)** — *Fait* : corps tête en
  bas = D1/D5 (flip Y de l'image de Rem). Vague sur tout le corps = effet de masque étiré (rapport
  EffectRenderer §F). Ce cas est traité dans le rapport EffectRenderer, mais l'inversion verticale de
  l'image de Rem est bien un cas de D1/D5 ici.
- **1179701732 (pétales)** — *Fait* : les pétales sont des particules ; leur vertex shader
  (`ParticleVertexShader`) utilise la convention centré Y-up (sans `1 -`), conforme à Linux
  (`ParticleRenderer.#vertices` convertit en centré Y-up). Donc D1 n'affecte **pas** les pétales ; leur
  positionnement dépend du parser de particules (rapport particules). *Note* : il reste une
  **incohérence de convention** entre particules (Y-up centré) et couches (Y-bas écran) dans le même
  projet (D4).

---

## 5. Résumé des divergences (tableau)

| Comportement | Linux (référence) | Komorebi | Divergence |
|---|---|---|---|
| Espace de `origin` des couches | centré Y-up (converti depuis écran, `CImage.cpp:~213-218`) | centré Y-up (`SceneModel.ts:443-473`) | conforme au stockage |
| Formule clip Y du shader couche | MVP ortho centrée → clip Y-up | `1 - y/H*2` (écrit Y-bas, `SceneVertexShader.ts:21`) | **D1 : inversion Y** |
| Alignment | espace écran Y-bas avant conversion (`CImage.cpp:~207-218`) | espace centré Y-up (`SceneModel.ts:459-468`) | **D2 : signe inversé** |
| Rotation | `-angle` autour du centre, Y-up (`CImage.cpp:~250-280`) | `-rotation` dans shader Y-bas (`LayerRenderer.ts:61`) | **D3 : sens à revoir avec D1** |
| UV / pixels | upload brut, orientation portée par géométrie | upload brut (`TextureUploader.ts:20`), UV v=1 en haut | **D5 : double inversion possible** |
| Convention globale du projet | centrée Y-up partout | couches Y-bas, particules Y-up, effets v=1 haut | **D4 : hétérogène** |
| Projection auto | calculée depuis extents objets (`CScene.cpp:~62-75`) | fournie par contexte (source non lue) | **D6 : incertain** |
| Parallaxe | translation sur MVP (`CImage.cpp:~258-268`) | non présente dans LayerRenderer/SceneVertexShader | **D7 : absente** |

---

## 6. Incertitudes (non comblées, sans supposition)

1. **Source de `projection`** passée à `RenderPipeline.render` : est-elle calculée en mode auto depuis
   les extents (comme Linux `CScene.cpp:~62-75`) ou depuis `camera.projection.width/height` ? Non lu
   dans ce périmètre → D6 reste une hypothèse.
2. **`camera.getProjection()` / `getLookAt()` exacts** de Linux (matrices ortho centrée) : non lus
   (`Camera.cpp` hors périmètre). La forme `ortho(-W/2, W/2, -H/2, H/2)` est standard mais non vérifiée
   ligne à ligne ici.
3. **UV exactes des couches simples** : `LayerRenderer` reconstruit `aTexCoord` à la volée
   (`LayerRenderer.ts:74-80`) avec `top/bottom` par défaut 0/`layer.v`. L'orientation finale dépend de
   l'interaction avec `SceneVertexShader` `1 - y/H*2` (D5) et n'est confirmable que par exécution.
4. **Parallaxe** : à confirmer qu'elle n'est pas gérée ailleurs que LayerRenderer/SceneVertexShader (D7).
5. **Shaders d'effet** (`EffectRenderer`) : leur convention d'UV/axe Y (FULLSCREEN_UVS v=1 en haut)
   n'est pas ré-analysée ici ; elle entre dans D4/D5 et est couverte partiellement par le rapport
   EffectRenderer.

---

## 7. Conclusion

Le portage parfait exige de **réconcilier la convention d'axe Y** entre les composants. Aujourd'hui :
- Les couches utilisent une formule de clip en espace écran Y-bas (`1 - y/H*2`) alors que leur `origin`
  est stocké en centré Y-up → **inversion Y + mauvais positionnement vertical** (D1), aggravée par un
  alignment inversé (D2) et une orientation UV/pixels ambiguë (D5).
- Les particules utilisent déjà la convention centré Y-up (conforme à Linux), créant une **incohérence**
  de convention dans le projet (D4).
- La parallaxe et le calcul auto de projection ne sont pas confirmés alignés (D6/D7).

Ces divergences expliquent directement les symptômes des 5 fonds cibles (images inversées, trop hautes,
à l'envers, fonds immobiles/mal orientés). Aucun correctif n'est proposé ici ; l'analyse est destinée à
guider le portage fidèle vers une convention unique centrée Y-up, identique à la référence Linux.

Fichiers cités — Linux : `CImage.cpp` (constructeur ~200-230, `updateScreenSpacePosition` ~250-280),
`CScene.cpp` (~60-75, `updateMouse` Y convention). Komorebi : `SceneModel.ts` (443-515),
`SceneVertexShader.ts` (11-24), `LayerRenderer.ts` (49-93), `Geometry.ts` (1-29),
`TextureUploader.ts` (10-66), `ParticleRenderer.ts` (314-321), `ParticleVertexShader.ts` (14-19),
`RenderPipeline.ts` (34-98).
