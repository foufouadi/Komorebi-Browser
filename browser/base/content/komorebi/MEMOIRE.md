# Mémoire des fonds animés

Mesures faites le 11/11/2026 sur une instance de test séparée (profil jetable, fenêtre 1920x1080), 12 s après le chargement de chaque fond. Les chiffres viennent de `ChromeUtils.requestProcInfo()` et des rapports de `about:memory`.

## Ce qu'on a trouvé

La mémoire part surtout dans la carte graphique, pas dans le JS. Changer de langage (Rust, WebAssembly) ne la ferait pas baisser : les mêmes pixels doivent être stockés sur le GPU.

| Fond | Total | GPU (dédiée) | Page du fond |
|---|---|---|---|
| Sans fond | 721 Mo | 165 Mo | 0 |
| Girl Error (3341577331) | 4 235 Mo | 3 486 Mo | 68 Mo |
| Luffy (3348681084) | 3 717 Mo | 836 Mo | 737 Mo |
| Yuta (3780699842) | 6 029 Mo | 4 194 Mo | 12 Mo |
| Persona 3 (3146703458) | 2 197 Mo | 795 Mo | 267 Mo |
| Miku Monitoring (3585875739) | 2 404 Mo | 973 Mo | 275 Mo |
| Frieren (3195212886) | 2 596 Mo | 866 Mo | 109 Mo |

Problèmes identifiés :

1. **Une image intermédiaire par passe d'effet.** `SceneLoader.preparePassTarget` créait une texture pleine taille pour chaque passe de chaque calque, gardée pendant toute la vie du fond.
2. **Le paquet .pkg gardé en entier.** `SceneModel` gardait toutes les entrées du paquet tant que le fond tournait. Pour Luffy, 749 Mo sur disque, soit environ 730 Mo dans la page du fond.
3. **Textures géantes.** Certaines scènes sont faites pour du 4K avec des animations image par image non compressées :
   - Yuta : 27 images de 7680x8100 en RGBA (oiseaux) et 30 images de 8004x6904 en DXT5, environ 8 Go une fois décompressées.
   - Girl Error : 46 textures, environ 2,1 Go, dont une de 7680x6480 en 5 images (949 Mo).
4. **Mémoire du processus principal** pendant le chargement de gros paquets (environ 900 Mo pour Luffy). Elle redescend au fond suivant ; la cause n'est pas encore identifiée, probablement le transfert du fichier vers la page.

Quand on change de fond, la mémoire du précédent est bien libérée : pas de fuite d'un fond à l'autre.

## Corrigé

- Les images intermédiaires sans nom sont prêtées par un pool partagé dans `EffectRenderer` (`#lendTarget`), par taille. Une passe ne reçoit jamais l'image qu'elle lit (résultat précédent ou entrée de l'effet). Les cibles nommées (`pass.target`, effets de simulation) gardent leur propre texture, car elles servent d'une image à l'autre.
- Le pool est vidé au changement de fond (`RenderPipeline.releaseTargets`, appelé depuis `SceneRenderer.#releaseScene`).
- `SceneModel.releasePackage()` lâche les fichiers du paquet une fois les calques construits ; les scripts n'utilisent que le JSON de la scène.

Résultat : Luffy passe de 3 717 à 3 099 Mo (page du fond 737 → 29 Mo), Frieren de 2 596 à 2 318 Mo (GPU 866 → 578 Mo). Après nettoyage, le dernier fond tombe de 1 771 à 1 392 Mo. Rendu identique sur 8 fonds riches en effets.

## À faire

1. **Réduire les textures à la résolution de l'écran.** Une scène faite pour 3840x2160 affichée en 1920x1080 n'a besoin que d'un quart des pixels. Au chargement, réduire chaque texture du facteur écran / scène, sur le GPU (envoi dans une texture temporaire, puis dessin réduit dans la texture finale). Garder les tailles d'origine dans les métadonnées pour que les coordonnées des sprites restent justes. Gain attendu sur un écran 1080p : Yuta d'environ 4 Go à 1-1,5 Go, Girl Error sous 1 Go. Aucun gain sur un écran 4K. À relier au réglage « Resolution » du panneau Performance.
2. **Textures DXT** : une réduction de moitié en RGBA prend autant de place que le DXT d'origine. Ne réduire le DXT qu'en dessous d'un facteur 0,5, ou réencoder.
3. **Chercher la mémoire du processus principal** pendant le chargement des gros paquets (point 4 ci-dessus).
4. **Lire le paquet sans copie** : `PackageReader` copie chaque entrée (`slice`), ce qui double la mémoire pendant le chargement. Passer à `subarray` demande de s'assurer qu'aucune petite entrée ne garde tout le paquet en vie.
5. **Plus tard, WebAssembly (Rust)** pour les calculs lourds côté processeur : os, particules, décodage, 3D. Ça ne réduira pas la mémoire graphique.
