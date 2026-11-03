# Travailler avec un assistant IA

Horizon calcule bien, mais il ne sait pas lire seul un relevé bancaire avec le jugement d'un analyste: relier un paiement à un bien, reconnaître un virement entre deux comptes, distinguer une épargne d'une dépense, éviter qu'une assurance soit comptée deux fois. Ce travail de synthèse se fait avec un assistant (par exemple Claude Code ouvert dans ce dépôt) qui lit tes documents et dépose des faits vérifiables dans Horizon. Voici la méthode, pour qu'elle soit reproductible.

## Principe

L'assistant ne devine rien. Il lit, recoupe, propose des faits avec leur source, et te montre chaque total à valider. Tout fait non confirmé reste marqué « supposé ».

## Méthode en neuf étapes

1. **Inventorier.** Lister les documents par type: relevés bancaires, cartes, certificats de prévoyance, déclarations et taxations, hypothèques, décomptes de gérance et de copropriété, polices d'assurance.
2. **Extraire.** Les PDF avec texte se lisent directement. Les scans se lisent comme des images. Sous macOS, un fichier iCloud « non téléchargé » doit d'abord l'être (`brctl download`).
3. **Relever avec la source.** Chaque chiffre garde son document, sa date et sa page.
4. **Recouper.** Les flux d'un compte sur douze mois doivent expliquer la variation de son solde. Un écart s'explique ou se signale.
5. **Exclure ce qui n'est pas de la consommation.** Virements entre ses propres comptes, épargne (3a, rachat LPP, remboursement d'un retrait EPL), amortissements de dette.
6. **Dédoublonner.** Un paiement ne compte qu'une fois. Les mêmes assurances ou impôts apparaissent souvent sur deux comptes.
7. **Séparer les périodes atypiques.** Une année de chômage, un déménagement ou un achat faussent une moyenne sur douze mois. Le dire.
8. **Immobilier.** Les loyers versés par une gérance sont déjà nets des charges de copropriété. Les intérêts se vérifient avec le taux effectif et le solde. Les valeurs de marché se confirment par une évaluation bancaire.
9. **Faire valider.** Présenter un tableau récapitulatif et corriger avec l'utilisateur avant de conclure.

## Déposer les faits

- Interface: onglets Données et Importer.
- API locale (même origine, JSON): `/api/add`, `/api/correct`, `/api/retire`, `/api/note`.
- Ligne de commande: `npm run ledger -- add '<json>'`.

Un fait a un `kind` (asset, liability, income, expense, household), une `key` stable, des `data` et une `origin` (user, document, inferred). Corriger un fait garde l'historique.

## Pièges rencontrés

- Une moyenne de dépenses qui contient déjà les impôts, les assurances et le loyer d'un enfant: ne pas les ajouter une deuxième fois.
- Un ordre permanent vers un compte tiers peut être le paiement de l'hypothèque de la résidence: le rattacher au bien.
- Les débits groupés d'une carte de crédit cachent le détail des dépenses: demander le relevé détaillé.
- Un salaire estimé sur quelques jours de paie n'est pas un net mensuel.
- Un document peut contenir un montant « à 0 » parce qu'il n'est pas à jour (libre passage pas encore reçu).

## Contrôle final

Actifs, dettes, revenus et dépenses mensuelles recoupés avec au moins un document par ligne importante, valeurs supposées listées, et verdict de la vue Retraite relu avec ses hypothèses.
