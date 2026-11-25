# Contribuer à Kayit

Merci de ton intérêt pour Kayit. C'est une PWA sans build ni backend : du HTML, du CSS et du JavaScript natif, rien de plus.

## Principes à respecter

Ces règles sont la raison d'être de l'app. Une contribution qui les enfreint ne sera pas acceptée, même si elle est utile par ailleurs.

- **Aucune donnée ne quitte le téléphone.** Pas de compte, pas de serveur, pas de statistiques, pas de script tiers.
- **CSP stricte.** `index.html` définit `connect-src 'self'` et `script-src 'self'`. N'ajoute aucune ressource venant d'un autre domaine (scripts, polices, images, requêtes).
- **Pas de dépendance inutile.** Les librairies vivent dans `vendor/` et sont versionnées dans le dépôt. Justifie toute nouvelle dépendance dans ta PR.
- **Vanilla JS.** Pas de framework, pas d'étape de build. Le code doit tourner tel quel dans le navigateur.

## Lancer le projet en local

```powershell
cd kayit
python -m http.server 8080
# puis ouvre http://localhost:8080
```

La caméra et le mode hors ligne demandent HTTPS ou `localhost`.

## Hook de pre-commit (à activer une fois par clone)

Le hook incrémente automatiquement la version du cache du service worker (`CACHE` dans `sw.js`) quand un fichier mis en cache est modifié. Sans lui, les téléphones gardent l'ancienne version.

```powershell
git config core.hooksPath .githooks
```

Si tu modifies `sw.js` à la main pour fixer la version, le hook ne touche à rien.

## Vérifications avant une PR

Il n'y a pas encore de suite de tests automatisés. Avant d'ouvrir une PR :

1. Vérifie la syntaxe des fichiers JavaScript modifiés :
   ```powershell
   node --check js/app.js
   ```
2. Teste le parcours que tu modifies dans le navigateur, sur un écran de téléphone (ou en émulation mobile) : ajout d'un code, scan, sauvegarde, verrouillage.
3. Vérifie qu'aucun appel vers un autre domaine n'a été introduit (onglet réseau du navigateur).

## Style de code

- Indentation de 2 espaces, point-virgule en fin de ligne, guillemets simples en JavaScript.
- Commentaires et textes destinés à l'utilisateur en français.
- Un commentaire pour expliquer le *pourquoi*, pas le *quoi*.
- Pas de `console.log` ni de code de débogage dans les commits.

## Commits et branches

- Une branche par sujet, créée à partir de `main`.
- Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/) : `feat(...)`, `fix(...)`, `chore(...)`, `docs(...)`.
- Une PR par sujet, avec une description claire : ce qui change, pourquoi, et ce qu'un relecteur doit vérifier.

## Données personnelles

Ne publie jamais de vrais codes de paiement, d'alias PI-SPI, de sauvegardes `.json` ou de captures contenant des données personnelles, ni dans le code, ni dans les tests, ni dans les issues. Utilise des valeurs fictives.

## Signaler un bug ou une faille

- Un bug fonctionnel : ouvre une issue avec les étapes pour le reproduire, le téléphone et le navigateur utilisés.
- Une faille de sécurité ou de confidentialité : ne l'ouvre pas en issue publique. Contacte le mainteneur en privé (voir le profil du dépôt).

## Licence

En contribuant, tu acceptes que ta contribution soit publiée sous la licence du projet.
