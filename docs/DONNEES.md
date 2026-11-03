# Informations à apporter à Horizon

Horizon donne une vue claire quand il connaît cinq choses: ce que tu as, ce que tu dois, ce qui entre, ce qui sort, et ce qui arrivera à la retraite. Les relevés bancaires s'analysent dans l'onglet Importer. Pour le reste, tu saisis les chiffres dans Données ou tu fais lire tes documents par un assistant IA ouvert dans le dépôt, qui dépose des faits à valider (voir `docs/ASSISTANT.md`).

## Pour une première vue (environ 15 minutes)

1. Foyer: personnes, années de naissance, âge de retraite visé.
2. Soldes de tes comptes courants et d'épargne.
3. Biens immobiliers: valeur estimée et hypothèque liée (solde, taux).
4. Salaire net mensuel et bonus annuel.
5. Dépenses mensuelles approximatives, même arrondies.
6. LPP: avoir de vieillesse (certificat de prévoyance).
7. 3a: solde et versement annuel.
8. AVS: rente estimée à la retraite.
9. Impôts: montant annuel.
10. Loyers encaissés, si tu as des biens locatifs.
11. Ordres permanents: leur composition (hypothèque, leasing, loyer d'un enfant, argent de poche), pour éviter les doubles comptes.

Chaque ligne manquante est remplacée par une valeur supposée, signalée, que tu corriges plus tard.

## Détail par famille

| Famille | Quoi | Où le trouver | Quand mettre à jour |
|---|---|---|---|
| Foyer | Personnes, naissances, âge de retraite | Livret de famille | Un événement de vie |
| Comptes courants et épargne | Solde de chaque compte, devise | Relevés, e-banking | Chaque trimestre |
| Cartes de crédit | Relevés détaillés (commerçant, montant) | Relevé mensuel | Chaque mois |
| Titres, fonds, crypto | Quantité, symbole, valeur | Relevé de dépôt | Chaque trimestre |
| AVS | Rente attendue, âge, années de cotisation | Extrait de compte individuel, rapport de prévoyance | Tous les 5 ans |
| LPP | Avoir, cotisations annuelles, capital projeté, rachat possible, libre passage | Certificat de prévoyance | Chaque année |
| 3a | Solde, versements annuels | Attestation fiscale au 31.12 | Chaque année |
| 3b, assurances vie | Valeur de rachat, échéance | Valeurs fiscales de l'assureur | Chaque année |
| Prévoyance à l'étranger | 401(k), IRA, rente américaine | Relevé du plan, ssa.gov | Chaque année |
| Immobilier | Valeur, adresse, surface, prix d'achat, année | Déclaration d'impôts, estimation, notaire | Chaque année |
| Loyers et charges | Loyer net, charges de copropriété, taxe foncière, travaux | Décomptes de gérance et de PPE | Chaque année |
| Hypothèques et dettes | Solde, taux, échéance du taux fixe, amortissement | Relevé de la banque | Chaque année et à chaque échéance |
| Revenus | Salaire net, bonus, autres revenus | Fiche de salaire | À chaque changement |
| Dépenses | Logement, assurances, vie courante, leasing, enfants | Relevés sur 12 mois | Chaque année |
| Impôts | Impôt annuel, acomptes, fortune imposable | Taxation, bordereau | Chaque année |
| Historique fiscal | Revenu et fortune imposables, impôts cantonal et fédéral, solde, sur 3 à 4 ans | Déclarations et décisions de taxation | Chaque année |
| Véhicules et leasings | Mensualité, date de fin, valeur de reprise ou résiduelle, assurance | Contrat de leasing, police | À l'échéance |
| Enfants et études | Loyer d'étudiant, argent de poche, frais d'études, garde | Bail, relevés, ordres permanents | À chaque changement |
| Chômage | Gain assuré, taux, indemnités restantes | Décision de la caisse | À chaque décision |
| Frais bancaires et parts sociales | Coffre-fort, forfaits, parts sociales | Relevés de la banque | Chaque année |
| Situations de vie | Études, grosse dépense, retraite anticipée | Toi | Quand ça change |

## Ce qui rend les résultats fiables

- Une valeur confirmée par un document vaut mieux que dix estimations.
- Les valeurs immobilières pèsent le plus: une erreur de 10 % déplace le patrimoine net de dizaines de milliers de francs. Une évaluation bancaire règle la question.
- Une année atypique (chômage, achat) ne représente pas ton rythme normal: dis-le.
- Les virements entre tes propres comptes ne sont pas des dépenses.
- Un ordre permanent regroupe souvent plusieurs charges: indique ce qu'il couvre.
- Beaucoup d'hypothèques suisses ne s'amortissent pas: précise-le, sinon Horizon garde la dette stable.

## Importer tes documents

1. Dépose tes documents dans un dossier de ton ordinateur (déclarations d'impôts, relevés, hypothèques, leasings, assurances, certificats de prévoyance).
2. Dans l'onglet Importer, indique ce dossier, puis « Analyser maintenant », ou active le contrôle automatique (toutes les 15 minutes tant qu'Horizon tourne).
3. Horizon lit chaque nouveau fichier. Les scans sont lus par la reconnaissance de texte de macOS (Vision), sans rien envoyer.
4. Avant toute analyse, il masque localement: numéro AVS, IBAN, cartes, e-mails, téléphones, numéros de client, de contrat et de sociétaire, jour et mois de naissance (l'année reste), noms qui suivent « Monsieur » ou « Madame », adresses de rue. Les noms et adresses repérés sont mémorisés comme termes masqués.
5. Si tu as autorisé l'analyse (Confidentialité), le texte masqué est envoyé à un petit modèle qui propose des faits. Il n'écrit jamais un fait confirmé: tout arrive dans « À valider », avec l'extrait d'origine.
6. Un fichier déjà lu (même contenu) n'est jamais relu, même renommé ou déplacé.

Limites à connaître: les montants et les dates restent lisibles, car ils sont l'objet de l'analyse. Un nom isolé, sans titre devant, n'est pas toujours repéré: ajoute-le dans Confidentialité. Les noms de tiers (conseiller, vendeur) peuvent rester. Sans accord d'analyse, ou en mode local, les documents sont lus et masqués mais aucun fait n'est proposé automatiquement.
