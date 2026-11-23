# Kayit — mes codes de paiement

PWA 100 % locale pour ranger au même endroit **tes alias PI-SPI** et **tous tes autres QR codes** (Wave, Orange Money, banques, WhatsApp, Wi-Fi, liens…), plus un **carnet** pour les QR de tes proches et des marchands.

## Fonctions
- **Mes codes** : alias PI-SPI ou n'importe quel QR. Copie en un clic, favoris, recherche, filtres (Alias PI-SPI / Autres QR / Favoris).
- **Scanner ou importer** : caméra, capture d'écran ou photo. Le QR est lu sur le téléphone (jsQR et, si disponible, le BarcodeDetector natif). L'alias est détecté automatiquement (format UUID et QR EMVCo).
- **Retrouver ses QR** : l'image d'origine est gardée. Tu peux aussi afficher un « QR net » recréé à l'identique depuis le contenu du QR, puis l'enregistrer ou le partager en PNG.
- **Carnet** : proches et marchands, scannés une fois, gardés ici.
- **Logos** : importe une fois le logo d'un établissement (une capture de l'icône de l'app suffit, recadrée automatiquement). Il s'affiche sur tous tes codes, et en petit sur les contacts du carnet qui utilisent cet établissement. Tu peux les gérer depuis le formulaire ou dans Réglages › Logos des établissements. Kayit n'embarque aucun logo officiel : ce sont des marques déposées.
- **Étiquettes** : ajoute des étiquettes à un code ou un contact (ex. « Travail », « Famille ») et filtre par étiquette.
- **Code d'accès** : code à 4–6 chiffres (Réglages › Verrouillage), demandé à l'ouverture et après une minute en arrière-plan. C'est une protection contre l'ouverture accidentelle, pas un chiffrement des données.
- **QR en plein écran** : pour montrer un QR à un caissier ou un vendeur. La luminosité se règle sur le téléphone : le web ne peut pas la changer.
- **Sauvegarde** : export et restauration en `.json`, logos compris. Un rappel s'affiche tous les 30 jours par défaut (Réglages › Rappel d'export).
- Thème sombre, clair ou automatique. Fonctionne hors ligne et s'installe sur l'écran d'accueil.

## Ce que Kayit ne fait pas
- **Il ne paie pas.** Le paiement se fait toujours dans l'app de ton opérateur, qui affiche le nom du bénéficiaire.
- **Il n'envoie rien.** Aucun compte, aucun serveur, aucune statistique, aucun script tiers. Les polices et les librairies sont dans le dossier. Une CSP stricte (`connect-src 'self'`, `script-src 'self'`) bloque toute requête vers un autre site.
- Les données sont dans l'IndexedDB du navigateur. Si tu vides les données du site, elles disparaissent : exporte de temps en temps.

## Lancer en local
```bash
cd kayit
python -m http.server 8080
# ouvre http://localhost:8080
```
La caméra et le mode hors ligne exigent **HTTPS** (ou `localhost`). Sur le téléphone, passe par la version en ligne.

## Mettre en ligne (fichiers statiques, aucun backend)
- **O2switch** : crée un sous-domaine (ex. `kayit.lassanasiby.com`), active AutoSSL, puis envoie le contenu du dossier dans sa racine. Pas besoin de Passenger.
- **Vercel / Netlify / GitHub Pages** : déploie le dossier tel quel.

Après une mise à jour, change `CACHE` dans `sw.js` (ex. `kayit-v1.0.1`) pour que les téléphones récupèrent la nouvelle version.

## Structure
```
index.html             page unique, sprite d'icônes, CSP
css/app.css            design « Nuit de Dakar » (encre + citron vert, cartes ticket)
js/app.js              vues, formulaires, sauvegarde
js/qr.js               lecture (caméra/image) et génération de QR
js/db.js               stockage IndexedDB
sw.js                  cache hors ligne
manifest.webmanifest   installation PWA
vendor/                jsQR (Apache-2.0), qrcode-generator (MIT)
fonts/                 Space Grotesk, JetBrains Mono (OFL)
icons/                 icônes de l'app
```

## Note PI-SPI
Kayit ne dépend d'aucun format privé. Il garde le contenu brut de chaque QR, repère un alias au format UUID quand il y en a un et lit les champs EMVCo standard (nom, ville). Un QR recréé depuis le contenu d'origine est identique à l'original. Un QR fabriqué uniquement à partir du texte de l'alias peut ne pas être reconnu par toutes les apps d'opérateur : dans ce cas, copie l'alias.
