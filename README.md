# Contrôle chantier

Web app gratuite pour iPad, tablette Android et téléphone. Elle sert à :

- importer des **plans** (PDF, plusieurs pages possibles, ou photo/scan),
- placer des **points de contrôle** directement sur le plan, avec zoom au doigt,
- faire des **contrôles de cote** : cote plan, cote mesurée et tolérance ±. L'écart et la conformité sont calculés automatiquement,
- noter des **remarques d'exécution** (Observation / À reprendre / Levée) avec **photos**,
- produire un **rapport PDF** (synthèse, plans repérés, détail avec extrait du plan et photos), un **export Excel (CSV)** et une **sauvegarde** complète du chantier.

Aucun store, aucun serveur, aucun abonnement. Les données restent **sur l'appareil** et l'app fonctionne **hors connexion** une fois installée.

## 1. Mettre l'app en ligne (gratuit, une seule fois)

L'app doit être servie en **HTTPS** pour pouvoir être installée et fonctionner hors ligne. Le plus simple est **GitHub Pages** :

1. Créer un compte gratuit sur github.com, puis un dépôt (par exemple `controle-chantier`).
2. Envoyer le contenu de ce dossier dans le dépôt. Le bouton *Add file → Upload files* suffit : glisser tous les fichiers et dossiers sauf `.claude` et `exemples`.
3. Dans le dépôt, aller dans *Settings → Pages → Branch : main / root → Save*.
4. Après une minute, l'app est disponible sur `https://<votre-compte>.github.io/controle-chantier/`.

Alternatives gratuites : Netlify ou Cloudflare Pages (glisser-déposer du dossier).

> Remarque : l'adresse du dépôt est publique, mais **vos données ne le sont pas**. Plans, points et photos restent uniquement dans la tablette.

## 2. Installer sur la tablette ou le téléphone

- **iPad / iPhone (Safari)** : ouvrir l'adresse, puis *Partager* → *Sur l'écran d'accueil*.
- **Android (Chrome)** : ouvrir l'adresse, puis menu ⋮ → *Installer l'application*.

L'icône « Contrôle » apparaît sur l'écran d'accueil. L'app s'ouvre en plein écran et fonctionne sans réseau sur le chantier.

## 3. Utilisation

1. **Nouveau chantier** → **Ajouter un plan** (PDF depuis Fichiers, mail, Drive…).
2. Ouvrir le plan, appuyer sur **+ Point**, puis toucher l'endroit à contrôler.
3. Choisir **Contrôle de cote** (cote plan / mesurée / tolérance) ou **Remarque**, et ajouter des photos.
4. La couleur du repère indique le statut : rouge = non conforme, orange = à reprendre, gris = à mesurer, bleu = observation, vert = conforme ou levée.
5. Depuis la page du chantier : **Rapport PDF** (envoi par mail, AirDrop, Fichiers…), **Export Excel** ou **Sauvegarde**.

Astuce : vous pouvez préparer les points au bureau en saisissant uniquement les cotes plan (statut « À mesurer »), puis compléter les cotes mesurées sur le chantier.

### Plans DAO (DXF) : cotes et éléments cliquables

Un plan exporté en **DXF** depuis AutoCAD, Revit ou un autre logiciel de DAO s'importe avec **Ajouter un plan**. L'app reconnaît alors :
- les **cotes** : on touche le texte d'une cote, la cote plan se remplit toute seule, et il reste à saisir la mesure ;
- les **éléments** (blocs : douche, WC, baignoire, porte, poteau…) : on touche l'élément et on le marque Conforme, Non conforme ou Levée ;
- les **vues** du fichier (RDC, RDJ, façades…), dont chacune devient une page ;
- les **calques**, à afficher ou masquer par lot (bouton Calques), avec le nombre d'éléments contrôlés par calque.

Pour l'export : lier les XREF (`XREF` → *Lier*), ne pas décomposer les cotes ni les blocs, puis *Enregistrer sous* DXF.
Les très gros fichiers (plus de 100 Mo en DXF) sont à importer depuis le PC, puis à passer sur la tablette avec *Sauvegarde* → *Importer une sauvegarde*.

## 4. Sauvegardes : important

Les données sont stockées dans le navigateur de l'appareil. Si l'app est supprimée, ou si la tablette est perdue ou réinitialisée, elles sont perdues.
Faites régulièrement **Sauvegarde** (fichier `.json`) et gardez-la sur le PC ou le cloud. **Importer une sauvegarde** depuis l'accueil permet de transférer un chantier sur un autre appareil.

## 5. Mettre à jour l'app

Après avoir modifié des fichiers, changer `VERSION` dans `sw.js` (par exemple `v1` → `v2`) puis renvoyer les fichiers sur GitHub. Les tablettes récupèrent la mise à jour au lancement suivant.

## Tester sur le PC

```powershell
python -m http.server 8765
```

Puis ouvrir http://localhost:8765 dans Chrome ou Edge. Un plan d'essai se trouve dans `exemples/plan-exemple.pdf`.
