# Divergences de shaders prouvées : Komorebi vs linux-wallpaperengine

Audit shader par shader, SANS édition. Chaque point cite fichier+ligne des deux
côtés. Séparation stricte : FAIT PROUVÉ / APPROXIMATION / INFIRMÉ.

Convention Linux prouvée (référence) :
- Upload texture BRUT (CTexture.cpp, glTexImage2D, aucun flip) -> v=0 = haut image.
- Espace de scène centré Y-up ; UV des quads v=1 en haut (CImage::texcoordPass).
- Flip vertical FINAL au blit (CWallpaper::render : quad plein écran à positions
  Y inversées, "inverted positions so the final texture is rendered properly").

==================================================================
1. FLIP DU PIPELINE D'EFFET (FBO) — INFIRMÉ
==================================================================
Hypothèse testée : les couches AVEC effet ont leur image retournée à cause de
FULLSCREEN_UVS (v=1 en haut) combiné à l'upload brut dans un FBO relu inversé.

Trace (calcul sommet par sommet, Geometry.ts:1-28) :
- FULLSCREEN_VERTICES/UVS : sommet y=+1 (haut FBO) <-> uv(0,0) ; sommet y=-1
  (bas FBO) <-> uv v=1.
- Source uploadée brute : v=0 = haut image. Donc haut FBO (uv 0) = haut image,
  bas FBO (uv 1) = bas image -> LE FBO CONTIENT L'IMAGE DROITE.
- LayerRenderer : QUAD_VERTICES q0/q1 (local y=-0.5) <-> v=0 ; q2/q3/q5
  (local y=+0.5) <-> v=1. SceneVertexShader clip.y = 1 - worldY/H*2 :
  local y=-0.5 -> clip.y=+1 (haut écran) <-> v=0 du FBO = haut image.
  local y=+0.5 -> clip.y=-1 (bas écran) <-> v=1 du FBO = bas image.
- RESULTAT : haut écran = haut image, bas écran = bas image = IMAGE DROITE.

FAIT PROUVÉ : la chaîne d'effet ne retourne PAS l'image. Le flip FBO et le
"1 -" du SceneVertexShader se compensent (comme en Linux). Les couches à effet
ne sont PAS retournées par ce mécanisme.

Note de transparence : un sous-agent a conclu "retournée" en inversant
l'appariement UV<->sommet (il plaçait v=0 en y=-1 alors que Geometry.ts:11-28
place v=0 en y=+1). Sa conclusion est ERRONÉE ; le calcul ci-dessus la contredit
deux fois (appariement + résultat final).

==================================================================
2. MATRICE DE FRAME / SPRITESHEET (g_Texture0Rotation) — APPROXIMATION PROUVÉE
==================================================================
C'est la CAUSE RÉELLE des "sections d'image mal positionnées / mal orientées"
pour les fonds utilisant des spritesheets ou frames animés.

Linux CPass::resolveTextureAnimationState (CPass.cpp:258-273) :
  translation.x = frameCur->x      / textureWidth;
  translation.y = frameCur->y      / textureHeight;
  rotation.x    = frameCur->width1  / textureWidth;   // matrice 2x2 complète
  rotation.y    = frameCur->width2  / textureWidth;
  rotation.z    = frameCur->height2 / textureHeight;
  rotation.w    = frameCur->height1 / textureHeight;
Puis setupRenderTexture (197-202) envoie ces 4 valeurs dans g_Texture0Rotation
(et translation normalisée dans g_Texture0Translation).
Commentaire Linux (195-196) : cas des frames verticales vs horizontales
(termes croisés non nuls).

Komorebi EffectRenderer.#setPassUniforms (EffectRenderer.ts:213-218) :
  g_Texture0Translation = [frame?.left ?? 0, frame?.top ?? 0]   // TEXELS, non normalisés
  g_Texture0Rotation    = frame
      ? [frame.right - frame.left, 0, 0, frame.bottom - frame.top]  // DIAGONALE seulement
      : [0, 0, 0, 0];

Divergences prouvées :
  (a) Komorebi envoie DIAGONALE (termes croisés = 0) ; Linux envoie la matrice
      2x2 COMPLÈTE (width2/W et height2/H non nuls pour frames non alignés).
  (b) Komorebi IGNORE frame.left/frame.top dans la rotation (offset du sous-rect
      non pris en compte) ; Linux les inclut via width1/height1/height2.
  (c) g_Texture0Translation est en TEXELS bruts (left, top) côté Komorebi,
      alors que Linux l'envoie NORMALISÉE (x/W, y/H).
  -> Pour un spritesheet/frame : mauvais sous-rect affiché et/ou étiré/inversé
     selon l'axe = "sections mal orientées". FAIT PROUVÉ (approximation).

==================================================================
3. MATRICES mat4 FORCÉES À IDENTITY — APPROXIMATION PROUVÉE
==================================================================
Komorebi EffectRenderer.#setPassUniforms (EffectRenderer.ts:199-201) :
  if (metadata.type === "mat4") {
      gl.uniformMatrix4fv(location, false, IDENTITY_MATRIX);  // toujours identité
      continue;
  }

Linux CPass envoie les matrices RÉELLES (g_ModelMatrix, g_OrientationUp/Right,
matrices MVP de CImage/CParticle via addUniform). Les effets WE qui dépendent de
g_ModelMatrix / transformations réelles sont donc muets côté Komorebi.

FAIT PROUVÉ (approximation) : tout uniform mat4 est neutralisé. Impact selon
l'effet (certains ne dépendent que de g_Time/g_PointerPosition et passent ;
d'autres, avec transformation de géométrie, sont faux).

==================================================================
4. g_TexelSize — À VÉRIFIER (incertitude)
==================================================================
Komorebi (EffectRenderer.ts:208-211) : g_TexelSize = [1/projection[0], 1/projection[1]].
Linux : à confirmer si c'est la résolution de la texture ou de la projection.
Incertitude non résolue (impact mineur, effets de flou/échantillonnage).

==================================================================
5. SHADER DE COUCHE (SceneVertexShader) — CONFORME (plein écran)
==================================================================
Trace plein écran (docs/trace-plein-ecran.md) : quad plein écran, image droite.
Le "1 - worldPosition.y/uProjection.y*2.0" simule le flip du blit Linux.
FAIT PROUVÉ : conforme pour le cas simple. Pas d'approximation ici.

==================================================================
6. SHADER DE PARTICULE (ParticleVertexShader) — APPROXIMATION (rapport dédié)
==================================================================
Voir docs/rapport-portage-particles.md. Résumé : pas de MVP, spritesheet rect
seulement, blending hardcodé, pas de control points/rope. Concerne pétales/
particules, pas les "sections d'image" de couches.

==================================================================
CONCLUSION POUR "SECTIONS MAL ORIENTÉES"
==================================================================
- Le flip FBO n'est PAS en cause (INFIRMÉ en §1).
- La CAUSE RÉELLE documentée : §2 (matrice de frame UV approximative) et §3
  (matrices mat4 neutralisées). Ces deux points sont des FAITS PROUVÉS par
  citation ligne à ligne des deux côtés.
- Aucune modification n'est faite tant que tu ne valides pas visuellement.

Prochaine étape suggérée (après validation) : corriger §2 en envoyant la matrice
2x2 COMPLÈTE + translation NORMALISÉE (suivre CPass.cpp:258-273), et §3 en
calculant les matrices réelles au lieu d'IDENTITY.
