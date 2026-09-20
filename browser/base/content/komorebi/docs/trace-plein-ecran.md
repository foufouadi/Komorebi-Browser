# Trace end-to-end : fond plein écran (preuve de la convention actuelle)

But : prouver, sans hypothèse, comment un fond plein écran simple est rendu
aujourd'hui dans Komorebi, MAILLON PAR MAILLON, en calculant le résultat final
à la main. Aucune modification de code.

Entrées (scene.json typique) :
- general.orthogonalprojection = [1920, 1080] -> this.projection = [1920, 1080]
  (SceneModel.ts:118-119 lit pkg.scene.general?.orthogonalprojection, sinon [1280,720])
- Layer plein écran : fullscreen=true, origin="0 0 0" (défaut),
  size="0 0" -> taille = projection, alignment="center", rotation=0

==================================================================
ÉTAPE A — SceneModel.resolveLayerGeometry (SceneModel.ts:443-473)
==================================================================
- transform = resolveTransform(layer.object) -> origin=[0,0,0], scale=[1,1,1], angle=0
- size = [1920, 1080] (car !size[0]||!size[1] -> projection)
- fullscreen -> transform.origin = [projection[0]/2, projection[1]/2, 0] = [960, 540, 0]
- alignment "center" -> aucun ajustement (ni top/bottom ni left/right)
- layer.origin = [960, 540]

FAIT : origin est le CENTRE du quad, en espace [0..W]x[0..H] (coin bas-gauche = 0).
Pas d'espace "centré Y-up" ni "écran Y-down" appliqué ici.

==================================================================
ÉTAPE B — LayerRenderer.draw (LayerRenderer.ts:49-62)
==================================================================
- uOrigin = (960, 540) (pas de transform offset : transform.enabled=false)
- uSize   = (1920*1, 1080*1) = (1920, 1080)
- uRotation = -0 - 0 = 0

==================================================================
ÉTAPE C — SceneVertexShader (SceneVertexShader.ts:9-22)
==================================================================
- localPosition = aPosition * uSize ; QUAD_VERTICES = ±0.5 -> ±960, ±540
- worldPosition = uOrigin + rotate(localPosition, 0) = [960±960, 540±540]
    -> X ∈ {0, 1920}, Y ∈ {0, 1080}
- clip.x = worldPosition.x / uProjection.x * 2 = X/1920*2 -> {0, 2}
- clip.y = 1.0 - worldPosition.y/uProjection.y*2 = 1 - Y/1080*2
    -> Y=0 -> clip.y=1 (haut écran) ; Y=1080 -> clip.y=-1 (bas écran)

Sommets clip résultants : (-1,1) (1,1) (-1,-1) (-1,-1) (1,1) (1,-1)
= QUAD PLEIN ÉCRAN. ✓ Aucune régression tant qu'on ne touche pas origin.

==================================================================
ÉTAPE D — UV / image (LayerRenderer.ts:44-80 + TextureUploader.ts)
==================================================================
- frame null -> left=0, right=layer.u, top=0, bottom=layer.v
- layer.u = width/textureWidth = 1 ; layer.v = 1 (plein écran 1:1)
- buffer aTexCoord = (0,0)(1,0)(0,1)(0,1)(1,0)(1,1)
- TextureUploader (lignes 20,36-48) : PAS de UNPACK_FLIP_Y_WEBGL
    -> pixels uploadés tels quels ; ligne 0 de l'image source (HAUT) en v=0
- SceneFragmentShader : échantillonne uTexture à vTexCoord

==================================================================
ÉTAPE E — ORIENTATION DE L'IMAGE (calcul à la main)
==================================================================
- QUAD_VERTICES ordre : v0=(-0.5,-0.5) v1=(0.5,-0.5) v2=(-0.5,0.5) v3=(-0.5,0.5) v4=(0.5,-0.5) v5=(0.5,0.5)
- aTexCoord ordre    :  (0,0)  (1,0)  (0,1)  (0,1)  (1,0)  (1,1)
  -> sommet local y=-0.5 (BAS du quad local) reçoit v=0
     sommet local y=+0.5 (HAUT du quad local) reçoit v=1
- Clip : local y=-0.5 -> Y=540-540=0 -> clip.y=1 = HAUT écran ; ce sommet a v=0 = HAUT image
        local y=+0.5 -> Y=540+540=1080 -> clip.y=-1 = BAS écran ; v=1 = BAS image
- RÉSULTAT : HAUT image -> HAUT écran, BAS image -> BAS écran = IMAGE DROITE ✓

==================================================================
CONCLUSION PROUVÉE
==================================================================
Pour un fond plein écran standard, la chaîne actuelle (origin centré [W/2,H/2],
shader "1 -", UV top=0 en haut du quad local, upload sans flip) produit :
  (1) un quad plein écran,
  (2) une image DROITE.
La convention est donc COHÉRENTE et CORRECTE pour le cas plein écran simple.

Cela prouve a posteriori que la modification précédente (conversion
origin -> [0,0] via "sceneHeight/2 - ...") était ERRONÉE : elle ramenait
uOrigin à [0,0], le quad en [-960,960]x[-540,540] -> clip [-1,1]x[0,2] =
quart bas-gauche de l'écran. D'où la régression "canvas ne prend plus tout
le navigateur". L'état actuel (sans la modif) est le bon pour le plein écran.

==================================================================
CE QUI RESTE À Prouver (prochaines unités d'audit, SANS édition)
==================================================================
La trace montre que le plein écran simple est OK. Les problèmes des 5 fonds
viennent donc d'autres chemins, non couverts par cette trace :

- Fonds AVEC effet (passthrough/normal/copy) : passent par EffectRenderer qui
  rend la source dans un FBO via ScreenQuad + FULLSCREEN_UVS (v=1 en haut),
  puis LayerRenderer échantillonne ce FBO. À tracer : EffectRenderer.ts +
  ScreenQuad.ts + FULLSCREEN_UVS (Geometry.ts:21-29). Hypothèse à vérifier :
  le FBO reçoit-il l'image retournée (bas image en haut) à cause de
  FULLSCREEN_UVS v=1 combiné à l'upload brut, puis relu inversé par LayerRenderer ?
  -> Concernés : 2703206776 (inversée), 3759507080 (à l'envers), 2111201226 (Rem).

- Fonds avec alignment non-center / origin non nul / rotation :
  à tracer via resolveLayerGeometry + uRotation (déjà -layer.rotation).
  -> Concernés : 3479521040 (trop haut).

- Particules (cas 1179701732) : déjà traité à part (rapport dédié).

Aucune modification ne sera faite tant que chaque divergence n'est pas
prouvée des deux côtés (Linux + Komorebi) et validée visuellement.
