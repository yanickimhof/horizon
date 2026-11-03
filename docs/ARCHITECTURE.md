# Horizon : architecture

## Principe

L'utilisateur ne remplit pas de formulaire. Il parle, envoie un document ou une capture d'écran, et le système en tire des **faits** structurés, les soumet à validation, s'en souvient et recalcule. Quand une information manque, une **valeur supposée** est utilisée et signalée comme telle, jusqu'à ce que la vraie valeur arrive.

```
Entrée (message, voix, capture, PDF)
        │
        ▼
  Extraction (LLM)  ──►  Propositions (status: proposed, avec extrait source)
                                │
                  Validation en un geste (confirmer, corriger, refuser)
                                │
                                ▼
                    Registre de faits (SQLite, historique complet)
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
        Projection         Notes de contexte    Questions utiles
   (instantané à une date)  (mémoire qualitative) (ce qui réduit le plus l'incertitude)
              │
              ▼
   Moteur : anneaux, chocs, fiabilité, rêves
              │
              ▼
          Interface (anneaux) et coach
```

## Le registre de faits

Un fait est une affirmation datée : `kind`, `key` stable, `data` libre, `origin`, `status`, `confidence`, `why`, `excerpt`, `sourceId`.

| Statut | Signification | Compte dans les calculs |
|---|---|---|
| `proposed` | Extrait d'un message ou document, en attente | Non |
| `confirmed` | Validé par l'utilisateur | Oui |
| `assumed` | Valeur supposée (standard ou déduite) | Oui, signalée |
| `rejected` | Refusé | Non |
| `superseded` | Remplacé par un fait plus récent | Non (historique) |

Règles garanties par le code et testées :

1. Un fait n'est jamais modifié ni supprimé, il est remplacé. L'historique reste consultable (`history(key)`).
2. Une valeur supposée ne peut jamais écraser un fait confirmé.
3. Une proposition n'entre pas dans les calculs avant confirmation.
4. Les champs inconnus sont conservés : la base accepte tout, seul un noyau minimal est exigé par le moteur (`src/core/schema.ts`).

## Flexible mais fiable : deux couches

- **Noyau typé** (household, asset, liability, income, expense, goal) : ce que le moteur lit. Champs minimaux exigés, le reste est libre.
- **Couche libre** : champs supplémentaires dans `data`, et **notes de contexte** (`notes`) pour ce qui est qualitatif ("déménagement envisagé vers 2032"). Le coach les retient, le moteur ne les calcule pas. Une note utile se promeut en fait typé quand le moteur en a besoin.

## Valeurs supposées

`src/engine/defaults.ts` génère des dépenses standard selon le foyer (adultes, enfants, propriétaire ou locataire, revenu). Chaque ligne est créée en `assumed` avec sa raison. Elles sont **indicatives et non sourcées** : à valider avant toute diffusion. Le score de fiabilité (`reliability`) mesure la part de ce qui est confirmé, et désigne les trois lignes supposées qui pèsent le plus, donc les prochaines questions à poser.

## Hétérogénéité des patrimoines

Ce qui fait échouer la plupart des applications patrimoniales est la diversité des situations: elles imposent un cadre générique. Horizon part du principe inverse.

**Contrat minimal commun à tout actif**, même exotique:

1. valeur (ou quantité x cours) et devise
2. part détenue (copropriété, indivision)
3. quand c'est mobilisable (mois)
4. ce qu'on perd à la sortie (impôts, frais, décote)
5. croissance réelle supposée, via une classe de référence

Le **catalogue** (`src/engine/catalog.ts`) ne fait que préremplir ces propriétés pour un type donné (résidence, bien locatif, 401(k), options non acquises, art...). Un actif absent du catalogue se décrit directement par ces cinq propriétés ("Autre, sur mesure"). Ajouter un type = une ligne de données, sans toucher au moteur. Priorité: valeur saisie sur la ligne, puis profil du type, puis règle du compte, puis classe.

Les règles propres à un pays vivent dans des tables de données (`accounts.ts`: LPP, 3a, 401(k), IRA, Roth), pas dans le code des calculs.

## Devises, cours, crypto

- Tout est converti en CHF au dernier cours connu (`fx.ts`). Chaque cours garde date et source, l'historique est conservé (table `prices`).
- Un cours manquant ne produit jamais un résultat silencieux: repli 1 pour 1, ligne marquée supposée, suggestion prioritaire. Un cours de plus de 30 jours est signalé périmé.
- Un actif coté (crypto) se décrit par symbole et quantité: la valeur vient du cours.
- La mise à jour publique (BCE, liste des cryptos) demande toujours la liste complète, jamais les avoirs, passe par le point de sortie unique et exige son propre accord. Sinon, saisie manuelle.

## Hypothèses, trois cas, simulations à venir

Tout ce qui dépend de l'avenir vit dans un objet `Assumptions` explicite (`assumptions.ts`): croissance réelle par classe d'actifs, dérive des devises, dérive des dépenses. Le moteur raisonne en francs d'aujourd'hui.

- **Pire cas, cas de base, meilleur cas** sont trois jeux d'hypothèses (valeurs indicatives, non sourcées, à discuter). Chaque anneau affiche le cas choisi et la fourchette pire à meilleur.
- Un **choc** transforme l'instantané (krach, immobilier, taux, inflation, franc fort, crypto).
- Une **simulation** sera une combinaison: instantané à une date future (`project(facts, asOf)` le permet déjà, les événements de vie étant des faits datés) + jeu d'hypothèses + chocs. Le moteur ne changera pas. Les distributions (Monte Carlo) viendront comme une couche au-dessus, en échantillonnant ces mêmes hypothèses.

Estimation immobilière (`property.ts`): fourchette et détail des méthodes (prix indexé, comparables, loyer capitalisé, valeur fiscale), sans jamais interroger un service avec l'adresse.

## Situations de vie

Une situation de vie n'est pas du code spécial: c'est un **flux daté**. Une dépense ou un revenu peut avoir une fenêtre (`startYear`/`endYear` ou `startAge`/`endAge`), et une dépense ponctuelle (`frequency: once`) tombe à une date. Le moteur calcule la demande **mois par mois** (`demandCurve`): études qui commencent et finissent, rente qui démarre à la retraite, travaux à leur date, dérive du niveau de vie selon le cas. Les anneaux et la tenue en découlent, sans formule particulière par événement.

- Modèles prêts à l'emploi (`events.ts`): enfant aux études, grosse dépense, enfant à charge, rente à la retraite (AVS, LPP, Social Security). Aucun montant par défaut: seul l'utilisateur sait.
- Les dépenses futures n'entrent pas dans le coût de vie d'aujourd'hui. Elles apparaissent dans « À venir », exprimées sans montant (mois de vie, part du coût mensuel).
- Ajouter une situation = ajouter un modèle de faits. Les simulations futures (« et si j'ai un troisième enfant en 2029 ? ») réutiliseront ce même mécanisme sur un instantané modifié.

## Coach

Les consignes vivent dans `server/coach.ts`, testées. Pour une question « comment gérer telle situation », le coach suit une structure fixe: ce que montrent les données, pistes à explorer (intérêt, limite, risque), ce qui change selon le cas, quoi vérifier avec quel professionnel, ce qui manque. Garde-fous: aucun produit, titre ou plateforme recommandé, aucun rendement promis, signalement que les règles fiscales varient et peuvent être périmées, insistance sur la vérification avant une décision lourde, orientation vers un service de conseil en cas de détresse. Le contexte transmis ne contient que des proportions et durées, y compris pour les événements à venir.

## Documents et recherche

- Plusieurs dossiers à la fois. Le nom du dossier (US, CH, une année) aide à reconnaître pays, année et type (`docmeta.ts`). Les années d'impôts manquantes sont suggérées.
- Le texte masqué est découpé en passages et indexé localement (SQLite FTS5). L'index ne contient jamais le brut. Une question devient une requête sûre (termes entre guillemets seulement).
- Le coach retrouve les passages pertinents et les cite par numéro. Ils contiennent de vrais montants: réservés au modèle local, ou au coach en ligne avec un accord distinct.
- Les tendances sur plusieurs années viendront d'enregistrements annuels (déclarations lues en faits datés), à construire; la recherche répond déjà en comparant les années présentes dans les extraits.

## Le moteur

| Module | Rôle |
|---|---|
| `horizons.ts` | Les quatre anneaux (3 mois, 1 an, 5 ans, 20 ans) : part du niveau de vie couverte si le salaire s'arrête, et par quelles sources. Tenue en mois. |
| `stress.ts` | Cinq chocs : krach, immobilier, taux, inflation, franc fort. Chacun renvoie des anneaux et une tenue. |
| `reliability.ts` | Fiabilité des données et lignes à préciser. |
| `goals.ts` | Un rêve devient un repère sur l'anneau de son échéance, coût exprimé en mois de vie. |

Hypothèses actuelles (à rendre visibles et modifiables dans l'interface) : décote de 10 % sur les titres, 10 à 25 % sur l'immobilier selon qu'il est occupé, immobilier mobilisable après 5 ans et net de la dette garantie, prévoyance mobilisable à la retraite.

## Import de dossier, manques, apprentissage

- `server/intake.ts` parcourt un dossier, extrait le texte (texte brut, PDF via `pdftotext`, images via `tesseract` si présents), **masque AVS, IBAN, cartes, emails, téléphones avant toute écriture**, et ne retraite jamais un fichier déjà vu (empreinte du contenu). Ce qui n'a pas de texte exploitable est signalé « à lire visuellement ».
- `src/engine/gaps.ts` classe les informations manquantes par gain pour l'analyse et ne redemande jamais ce qui est déjà importé ou confirmé.
- Table `rules` : une validation ou correction de l'utilisateur peut devenir une règle (commerçant vers catégorie, type de document vers extracteur). `autonomy()` mesure la part des documents traités sans modèle : c'est l'indicateur d'indépendance du système. Il ne s'agit pas d'entraîner un modèle, mais d'accumuler des règles et des faits qui réduisent le besoin d'en appeler un.

## Confidentialité

Une souveraineté totale n'est pas possible dès qu'un modèle externe intervient. L'objectif est donc une protection **vérifiable**, par défaut stricte.

| Couche | Mécanisme | Où |
|---|---|---|
| Minimisation | Le coach ne reçoit jamais de montant en francs: parts, ratios, durées. Les calculs restent locaux. | `server/api.ts` |
| Masquage | AVS, IBAN, cartes (contrôle de Luhn), emails, téléphones masqués avant toute écriture. | `src/core/redact.ts` |
| Pseudonymisation | Noms, employeurs, adresses listés par l'utilisateur remplacés par des jetons stables (`[PERSONNE_1]`), restaurés localement dans les réponses et dans les propositions de faits. | `src/core/pseudonym.ts` |
| Point de sortie unique | Aucun appel réseau hors de `server/egress.ts`. Un test d'architecture échoue si un autre fichier en contient. | `server/egress.ts`, `server/privacy.test.ts` |
| Politique | Mode local par défaut. Mode assisté: envoi possible seulement avec un accord explicite et révocable. `HORIZON_PRIVACY=local` l'impose depuis l'environnement. | `server/egress.ts` |
| Traçabilité | Chaque envoi, accepté ou bloqué, est journalisé avec taille et empreinte, jamais le contenu. | table `egress` |
| Transparence | L'écran Confidentialité affiche le texte exact, tel qu'il serait envoyé. | `src/views/Privacy.tsx` |
| Interface | Aucune ressource externe chargée (vérifié par test navigateur). | |

### Accès à distance (Tailscale)

Horizon peut tourner en arrière-plan sur le Mac et être ouvert depuis tes autres appareils via Tailscale Serve. L'application n'a pas de mot de passe: la protection est dans la conception, et se vérifie par des tests (`access.test.ts`, `service.test.ts`).

| Menace | Parade |
|---|---|
| Un autre appareil du réseau Tailscale | Seul le compte listé dans `HORIZON_ALLOWED_LOGIN` passe. Sans cette variable, tout accès distant est refusé |
| Connexion directe sur le réseau local | Le serveur n'écoute que sur `127.0.0.1`; une connexion qui ne vient pas de la machine est refusée, même avec une identité Tailscale falsifiée |
| Page web malveillante ouverte dans ton navigateur | Une écriture doit être en JSON et, si elle porte une origine, la même que l'hôte: un formulaire ou un envoi `text/plain` venant d'un autre site est refusé |
| DNS rebinding | Le nom d'hôte doit être local ou en `.ts.net` |
| Lecture du disque à distance | L'import de dossiers est refusé pour tout appel venu d'un autre appareil |
| Publication sur Internet | Le script n'utilise que `tailscale serve`, jamais `funnel`, et un test échoue si ça change |
| Autres services Tailscale de la machine | Publication sur le port 8443 seulement, jamais de remise à zéro globale |

Limites à connaître: le Mac doit être allumé et éveillé pour répondre; Tailscale chiffre le trafic mais reste le service de coordination du réseau; quiconque contrôle le Mac ou ton compte Tailscale a accès. Les données restent sur le Mac: aucun transfert vers le téléphone, seulement une vue.

### Secrets et clés d'API

- Une clé d'API ne vit **jamais** dans la base ni dans le dépôt: variable d'environnement (ou trousseau du système). L'interface n'affiche que sa présence.
- Chaque service externe aura son propre **but** dans le point de sortie et son propre accord (comme `coach`, `market`). Un nouveau connecteur = un nouveau but, jamais un contournement.
- `server/secrets.test.ts` échoue si un secret apparaît dans le code, si un `.env` existe dans le dépôt, ou si `.gitignore` ne protège plus les données.

### Ce qui n'est pas couvert

- La conversation avec Claude est hors d'Horizon: ce qui y est partagé est traité par Anthropic, et ne passe pas par le journal. Discipline recommandée: ne partager que le texte déjà masqué de `inbox/extracted`.
- Les libellés de lignes et le texte des notes sont envoyés tels quels (après pseudonymisation des termes listés). Un nom non listé n'est pas protégé.
- Les documents sensibles lus par un modèle externe restent exposés au fournisseur selon ses conditions. Les conditions commerciales de l'API excluent l'entraînement, mais la durée de conservation est à vérifier dans l'accord en vigueur.
- Pas encore de chiffrement de la base au repos: s'appuyer sur le chiffrement du disque (FileVault).

### Pistes suivantes

1. Chiffrement de la base avec phrase secrète.
2. Extraction locale de documents par un modèle local, avec envoi externe seulement document par document, après aperçu et accord.
3. Détection automatique de noms propres pour proposer des termes à protéger.

## Entrée par la voix

Aucun module de reconnaissance vocale à construire au départ : la dictée du système ou un outil de dictée alimente le champ de message comme du texte. Une capture de micro intégrée peut venir plus tard.

## Étapes suivantes

1. Interface des anneaux avec barre de chocs (concept B).
2. Boîte de validation des propositions et file de questions utiles.
3. Extraction : conversation avec Claude (outil `ledger add`), puis appel API intégré avec rédaction préalable des données sensibles.
4. Coach : questions sur la situation, ancrées sur le registre et les notes.
5. Rêves sur les anneaux, simulateur « et si ».

## Avertissement

Outil d'aide à la réflexion et à l'organisation. Il ne constitue pas un conseil en placement. Le cadrage réglementaire (LSFin) est à faire valider avant toute suggestion d'investissement personnalisée.


## Ajouts récents

- **Retraite** (`src/engine/retirement.ts`, `src/views/Retraite.tsx`): simulation mois par mois jusqu'à 95 ans, en francs d'aujourd'hui, calculée dans le navigateur. Ventes de biens, hausse des taux, perte de salaire avec chômage, rachat d'un 401(k), cotisations LPP et rentes futures. Les paramètres propres à un pays sont dans `src/engine/country.ts`.
- **Relevés bancaires** (`server/statements.ts`, `server/statements-ai.ts`): lecture de CSV, classement par règles locales, virements entre comptes appariés, moyennes mensuelles, écart avec les dépenses connues. Les classements décidés par l'utilisateur sont mémorisés par signature (libellé et montant). Claude (Haiku) ne classe que des libellés inconnus, sans montant, après accord.
- **Claude en option** (`server/usage.ts`, `server/secrets.ts`): un seul point d'appel à l'API, qui applique la politique de confidentialité, refuse au-delà du plafond mensuel et consigne les jetons et le coût. La clé vient de l'environnement ou du trousseau macOS, jamais d'un fichier.
- **Partage** (`scripts/check-privacy.sh`, `.githooks/`): contrôle avant commit qu'aucun fichier ou terme personnel n'est versionné.


## Budget: de documents à chiffres

Le budget vit dans trois tables de la base (`budget_accounts`, `budget_txs`, `budget_estimates`) et quelques réglages (`budget.biens`, `budget.uniques`, `budget.imputation`, mémoire de classement). Aucune ligne n'est saisie à la main.

Chaîne de lecture (`server/watch.ts`):

1. **Extraction du texte**: `pdftotext` si disponible, sinon couche texte du PDF lue par PDFKit (`scripts/pdftext.swift`), sinon reconnaissance optique locale (`scripts/ocr.swift`). Le texte est masqué (`src/core/redact.ts`, noms et adresses appris dans les documents) avant toute lecture par un modèle.
2. **Relevés tabulaires** (CSV Migros, CSV Raiffeisen, camt.053): analyseurs déterministes dans `server/statements.ts`.
3. **Factures de carte Viseca** (`server/viseca.ts`): lecture déterministe, catégorie de la banque conservée (source `banque`), contrôle sur le total imprimé; un montant manquant se déduit du total si une seule ligne est en cause.
4. **Autres PDF qui ressemblent à un relevé**: un petit modèle renvoie les lignes (`server/tx-extract.ts`); un solde d'ouverture et de clôture réconcilie la somme, sinon rien n'est enregistré.
5. **Classement** (`reclassify` dans `server/budget.ts`): règles locales, virements entre comptes du foyer, appariement des virements internes, doublons entre comptes (la ligne gardée prend le libellé le plus complet), revenus exceptionnels (mois contre habitude de l'émetteur), mémoire de l'utilisateur; puis, pour ce qui reste inconnu, un petit modèle sur des libellés réduits (`server/budget-ai.ts`).
6. **Vue** (`budgetView`): mois par mois, revenus, dépenses, mis de côté, versements uniques, catégories, travaux et immobilier par bien, imputation d'un montant à une autre année.

Priorité des sources de classement: mémoire de l'utilisateur, puis catégorie de la banque, puis modèle, puis règles. Une ligne classée par la mémoire, le modèle ou la banque n'est jamais recalculée.
