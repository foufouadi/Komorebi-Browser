# Géométrie de couche : divergence prouvée (origine + alignment)

Audit shader/couche, SANS édition. Compare Komorebi (SceneModel.resolveLayerGeometry,
SceneVertexShader, LayerRenderer) à linux-wallpaperengine (CImage::updateScreenSpacePosition).

Symptômes visés : "dessins trop haut en terme de layer", "bg ou dessin mal positionné",
"yeux à droite du visage" (sous-couches décalées). Cause = géométrie de couche, PAS UV.

==================================================================
RÉFÉRENCE LINUX — CImage::updateScreenSpacePosition (CImage.cpp:225-262)
==================================================================
  scaledSize = size * scale;
  // origin interprété en ESPACE ÉCRAN Y-BAS (convention WE : y+ = bas écran)
  m_pos.x = origin.x - scaledSize.x/2;   // haut-gauche X
  m_pos.w = origin.y + scaledSize.y/2;   // haut-gauche Y
  m_pos.z = origin.x + scaledSize.x/2;   // bas-droite X
  m_pos.y = origin.y - scaledSize.y/2;   // bas-droite Y
  // ALIGNMENT en espace Y-BAS (AVANT conversion)
  if "top":    m_pos.y -= s/2; m_pos.w -= s/2;   // monte
  if "bottom": m_pos.y += s/2; m_pos.w += s/2;   // descend
  if "left":   m_pos.x += s/2; m_pos.z += s/2;
  if "right":  m_pos.x -= s/2; m_pos.z -= s/2;
  // CONVERSION vers ESPACE CENTRÉ Y-UP (après alignment)
  m_pos.x -= scene_width/2;
  m_pos.y  = scene_height/2 - m_pos.y;
  m_pos.z -= scene_width/2;
  m_pos.w  = scene_height/2 - m_pos.w;
  // rendu dans sceneSpacePosition[] (coins centrés Y-up), flip final au blit.

==================================================================
KOMOREBI ACTUEL — SceneModel.resolveLayerGeometry (443-473)
==================================================================
  layer.origin = this.vector(object.origin, [0,0]);   // BRUT JSON WE = Y-BAS écran
  if (fullscreen) transform.origin = [W/2, H/2, 0];   // Y-BAS ici !
  // ALIGNMENT direct en centré Y-up, signes INVERSES à Linux :
  if "top":    transform.origin[1] -= scaledHeight/2;  // Linux équivalent centré: +=
  if "bottom": transform.origin[1] += scaledHeight/2;  // Linux: -=
  if "left":   transform.origin[0] += scaledWidth/2;   // Linux: -=
  if "right":  transform.origin[0] -= scaledWidth/2;   // Linux: +=
  layer.origin = transform.origin;   // CENTRE du quad (shader: worldPos = uOrigin + rotate)

==================================================================
DIVERGENCES PROUVÉES
==================================================================
D1 — ORIGINE NON CONVERTIE (FAIT PROUVÉ)
  Linux convertit origin Y-bas -> centré Y-up (lignes 259-262). Komorebi garde
  origin Y-bas tel quel. Pour origin: "0 500 0" (H=1080) :
    Linux  -> centre + (H/2 - 500) = centre + 40px
    Komorebi -> centre + 500px  (lit 500 comme Y-up au lieu de Y-bas)
  -> couche placée ~460px TROP HAUT. Explique "trop haut" / "yeux décalés".

D2 — ALIGNMENT INVERSÉ X et Y (FAIT PROUVÉ)
  Linux applique alignment en Y-bas puis convertit -> équivalent centré :
    top->+s/2, bottom->-s/2, left->-s/2, right->+s/2 (en espace centré).
  Komorebi applique en centré avec signes OPPOSÉS (top->-=, left->+=, ...).
  -> alignment inversé sur les deux axes.

D3 — FULLSCREEN (cohérent, NE PAS casser)
  Actuel : fullscreen origin [W/2,H/2] Y-bas, alignment center (rien) -> centre.
  Le shader "1 -" simule le flip du blit Linux. Plein écran OK (voir trace-plein-ecran.md).

==================================================================
CORRECTION PROPOSÉE (fidèle à CImage.cpp:236-262, NE casse PAS fullscreen)
==================================================================
Dans resolveLayerGeometry, APRÈS le calcul de transform.origin et gestion
fullscreen, remplacer le bloc alignment (459-468) par :

  const W = this.projection[0];
  const H = this.projection[1];
  // conversion origine Y-bas -> centré Y-up (CImage.cpp:259-262)
  transform.origin = [
    transform.origin[0] - W / 2,
    H / 2 - transform.origin[1],
    transform.origin[2],
  ];
  // alignment en espace centré Y-up (signes dérivés de CImage.cpp:242-256 + conversion)
  const scaledWidth = size[0] * transform.scale[0];
  const scaledHeight = size[1] * transform.scale[1];
  const alignment = layer.alignment.toLowerCase();
  if (alignment.includes("top")) {
    transform.origin[1] += scaledHeight / 2;
  } else if (alignment.includes("bottom")) {
    transform.origin[1] -= scaledHeight / 2;
  }
  if (alignment.includes("left")) {
    transform.origin[0] -= scaledWidth / 2;
  } else if (alignment.includes("right")) {
    transform.origin[0] += scaledWidth / 2;
  }

VÉRIFICATION FULLSCREEN : origin [W/2,H/2] -> [0,0] -> alignment center -> [0,0].
  uOrigin=[0,0], uSize=[W,H], shader "1 -" -> plein écran. ✅ (pas de régression quart-écran)

ROTATION : uRotation = -layer.rotation (LayerRenderer:61) reste tel quel.
  Cohérent avec Linux (-angle Y-up) + flip "1 -". Validé par trace plein écran.

==================================================================
STATUT
==================================================================
- Aucune modification appliquée. Diff proposé ci-dessus pour validation visuelle
  sur les 5 fonds (1179701732, 3479521040, 2703206776, 3759507080, 2111201226).
- À tester : couches avec origin non-nul (3479521040 "trop haut"), alignment non-center,
  sous-couches décalées (yeux/visage), fullscreen (régression à surveiller).
