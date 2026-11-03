# Guide: de tes documents à ta situation financière

Ce guide s'adresse à quelqu'un qui découvre Horizon. En une heure, avec tes documents sous la main, tu obtiens un état de situation clair: ce qui rentre, ce qui sort, ce qui reste, par mois et par année, et ce qui pèse dans le budget.

Tout se passe sur ton ordinateur. Les noms, adresses et numéros sont masqués avant toute lecture par un modèle, et rien n'est envoyé sans ton accord (voir [Confidentialité](../README.md#confidentialité)).

## 1. Le principe

1. **Tu déposes** tes documents dans un dossier.
2. **Horizon lit** tout seul: relevés de comptes et de cartes, impôts, contrats.
3. **Tu précises** trois choses que les documents ne disent pas (section 4).
4. **Tu contrôles** les chiffres avec les soldes de tes comptes (section 6).

Horizon ne te demande pas de valider ligne par ligne. Il classe seul, écarte les doublons et les virements entre tes comptes, et ne te montre que ce qu'il ne comprend pas.

## 2. Préparer le dossier

Crée un dossier (par exemple `Horizon-Documents`) avec cette arborescence. Tu peux ne remplir que ce que tu as; le dossier `9-A-trier` accueille tout le reste.

| Dossier | Quoi y mettre | Formats |
|---|---|---|
| `1-Releves/Comptes` | un export par compte, sur la période la plus longue possible (idéalement 3 ans) | CSV, camt.053 (XML), PDF |
| `1-Releves/Cartes-de-credit` | une facture par mois | PDF |
| `1-Releves/Twint`, `Especes-et-factures` | exports Twint, factures payées en espèces | CSV, PDF, photos |
| `2-Impots/<année>` | déclaration, décision de taxation, acomptes, bordereaux (3 à 5 ans) | PDF |
| `3-Immobilier` | décomptes de gérance, hypothèques, décomptes PPE | PDF |
| `4-Assurances`, `5-Prevoyance` | polices, certificat LPP, attestation 3a, extrait AVS | PDF |
| `6-Vehicules` | contrats de leasing ou d'achat | PDF |
| `7-Famille`, `8-Revenus` | fiches de salaire, décision de chômage, décomptes de loyers | PDF |

Conseils pratiques:
- **Période:** prends la même période pour tous les comptes. Un compte qui commence plus tard fausse les moyennes.
- **Plusieurs fichiers pour le même compte** (CSV et PDF): ce n'est pas un problème, les doublons sont écartés.
- **Cartes de crédit:** la facture mensuelle suffit. Si la banque est suisse et utilise Viseca, la lecture est exacte et contrôlée sur le total imprimé.
- **Aucun import manuel:** pas besoin de renommer ni de trier.

## 3. Première lecture

Dans l'écran **Budget**, indique le dossier et clique sur **Relire le dossier**. Une animation indique que le travail avance, tu peux fermer l'écran.

Horizon fait, dans l'ordre:
1. il lit chaque fichier, masque les identifiants (AVS, IBAN, numéros, adresses, noms) ;
2. il enregistre les opérations des relevés et écarte les doublons (même opération dans un CSV et un PDF) ;
3. il classe chaque ligne: d'abord par règles locales, puis, pour ce qui reste inconnu, par un petit modèle qui ne reçoit que des libellés réduits, sans montant ni date ;
4. il lit les autres documents (impôts, contrats) et te propose les chiffres importants, à valider dans l'onglet **À valider**.

Une relecture suivante ne lit que les nouveaux fichiers.

## 4. Les trois informations à lui donner

Elles ne figurent pas dans les relevés, mais changent tout.

1. **Le foyer.** Prénoms des adultes et des enfants (onglet Données). Un virement vers toi-même est un mouvement entre tes comptes, pas une dépense; un virement vers un enfant est une dépense du foyer.
2. **Les biens immobiliers (si tu en as).** Pour chaque bien: nom, valeur, hypothèque. Les relevés d'intérêts indiquent un numéro de prêt: associe chaque numéro à son bien, et chaque fournisseur de travaux au sien. Horizon sépare ensuite domicile et locatif, avec loyers, charges et net par bien.
3. **Ce qui sort du rythme habituel.** Un solde d'impôts d'une année précédente, un remboursement d'impôt, un gros versement unique (indemnité de départ, vente): dis-le une fois, Horizon les met à part et impute l'impôt à son année.

## 5. Lire le résultat

L'écran **Budget** répond à quatre questions:

| Question | Où |
|---|---|
| Combien rentre, combien sort, combien reste-t-il ? | les trois tuiles du haut (moyenne mensuelle) |
| Quel est mon rythme habituel ? | « Habituelles, sans travaux ni montants uniques » |
| Où va l'argent ? | « Où part l'argent », avec la tendance (3 derniers mois, ou année contre année) |
| Qu'est-ce qui rapporte, qu'est-ce qui coûte ? | « Immobilier: ménage et locatif », « Travaux par bien » |

- **Sélecteur de période:** 12 derniers mois, ou une année (la comparaison avec l'année précédente s'affiche pour chaque catégorie).
- **Versements uniques:** ils sont comptés dans les totaux, mais pas dans la moyenne mensuelle.
- **Mis de côté:** épargne, 3e pilier, rachats de caisse de pension, amortissements: ce n'est pas une dépense.
- **À identifier:** il ne reste là que ce qu'Horizon ne sait pas classer. Chaque ligne indique la date, le compte et l'occurrence. « Je ne sais pas » est une réponse acceptée.

## 6. Contrôler les chiffres

Horizon contrôle seul ce qu'il peut:
- **Factures de carte Viseca:** la somme des achats doit retrouver le total imprimé sur la facture. Sinon, rien n'est enregistré et un message le dit.
- **Doublons:** deux comptes qui contiennent les mêmes opérations sont détectés.
- **Virements entre tes comptes:** ils se compensent à zéro, sinon il y a un oubli.

Pour une preuve complète, donne le **solde de chaque compte au premier et au dernier jour** de la période. La variation du solde doit être égale à la somme des lignes. Si c'est le cas, rien ne manque. Si le solde monte de plus que les lignes, il manque des crédits (intérêts par exemple); s'il monte de moins, il manque des dépenses.

## 7. Cas particuliers: n'en tiens compte que si tu es concerné

- **Comptes ou placements en euros ou en dollars:** dépose les relevés comme les autres. Horizon convertit en francs au cours du jour et affiche les devises. Si tu n'as aucun compte étranger, ces options n'apparaissent pas.
- **Prévoyance à l'étranger** (401(k), IRA, rente américaine): ajoute les relevés dans `5-Prevoyance`. La rubrique ne s'affiche que si elle est utile.
- **Dépenses payées avec une carte que tu n'as plus** (néobanque, carte expirée): dans « Dépenses connues hors relevés », indique un montant mensuel; il est marqué « estimé ».
- **Crypto, titres:** dépose le relevé de dépôt ou l'export de la plateforme.

## 8. Limites

- Horizon lit des PDF dont le texte est intégré. Un PDF scanné passe par la reconnaissance optique locale (macOS), moins fiable: contrôle-le avec les soldes.
- Un relevé sans solde d'ouverture ne peut pas être contrôlé seul.
- Les règles de classement sont écrites pour la Suisse (commerçants, assurances, impôts). Dans un autre pays, il faudra compléter les règles.
- Horizon aide à réfléchir. Ce n'est pas un conseil fiscal, de prévoyance ou de placement.

## 9. Et ensuite ?

Quand le budget est fiable, les dépenses habituelles servent de base aux modules suivants: besoins à la retraite, rachats de caisse de pension, vente d'un bien, hausse des taux. Ces écrans existent déjà (onglet Retraite, masqué par défaut); ils sont en cours de remise à plat à partir des dépenses réelles.

## Ce que l'outil retient

Quand tu classes une ligne, l'outil retient le fournisseur et l'applique aux lignes semblables, passées et à venir. Pour un libellé trop générique (un virement, un paiement par carte sans nom), seule la ligne exacte est retenue. Tes corrections ne sont jamais écrasées par un reclassement automatique.

Le tableau « Dépenses par catégorie » affiche uniquement les catégories où tu as des dépenses, par année ou par mois.
