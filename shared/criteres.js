/* ============================================================
   TABLE UNIQUE DES CRITÈRES PAR CATÉGORIE
   ------------------------------------------------------------
   Ce fichier est utilisé À LA FOIS par l'interface (src/) et par
   le serveur (server/) : une seule source de vérité, donc aucun
   risque que les deux se contredisent un jour.

   Règle importante : les CLÉS (quality, wear, value, skin…) ne
   changent JAMAIS, sinon les avis déjà enregistrés perdraient
   leurs critères. Seuls les LIBELLÉS affichés peuvent évoluer.
   ============================================================ */

// Critères notés de 1 à 5, par catégorie. [clé stable, libellé affiché]
const NOTES = {
  'Maquillage': [
    ['quality', 'Qualité du produit'],
    ['wear', 'Tenue dans le temps'],
    ['application', 'Facilité d’application'],
    ['result', 'Résultat obtenu'],
    ['value', 'Rapport qualité-prix']
  ],
  'Soins': [
    ['texture', 'Texture et facilité d’utilisation'],
    ['result', 'Résultats ressentis'],
    ['tolerance', 'Tolérance personnelle'],
    ['value', 'Rapport qualité-prix']
  ],
  'Mode': [
    ['fit', 'Coupe et confort'],
    ['quality', 'Qualité des matériaux'],
    ['accuracy', 'Fidélité des couleurs et du rendu'],
    ['value', 'Rapport qualité-prix']
  ],
  'Chaussures & sacs': [
    ['fit', 'Coupe et confort'],
    ['quality', 'Qualité des matériaux'],
    ['accuracy', 'Fidélité des couleurs et du rendu'],
    ['value', 'Rapport qualité-prix']
  ],
  'Parfums': [
    ['scent', 'Odeur perçue'],
    ['wear', 'Tenue estimée'],
    ['intensity', 'Intensité'],
    ['value', 'Rapport qualité-prix']
  ]
};

// « Beauté », « Cheveux » et « Hygiène » partagent les critères des soins
NOTES['Beauté'] = NOTES['Soins'];
NOTES['Cheveux'] = NOTES['Soins'];
NOTES['Hygiène'] = NOTES['Soins'];

// Toute autre catégorie (Lifestyle…) reste simple : deux critères suffisent.
const NOTES_PAR_DEFAUT = [['quality', 'Qualité'], ['value', 'Rapport qualité-prix']];

/* Champs TEXTE facultatifs (pas des notes) :
   - skin / hair : type de peau ou de cheveux déclaré par la personne
   - sizeUsual / sizeOrdered : taille habituelle et taille commandée
   - occasion : moments d'utilisation d'un parfum
   « groupe » sert uniquement à afficher deux champs côte à côte. */
const TEXTES = {
  'Soins': [
    { key: 'skin', label: 'Type de peau', exemple: 'Ex. mixte, sensible', groupe: 'peau' }
  ],
  'Beauté': [
    { key: 'skin', label: 'Type de peau', exemple: 'Ex. mixte, sensible', groupe: 'peau' }
  ],
  'Hygiène': [
    { key: 'skin', label: 'Type de peau', exemple: 'Ex. sensible, atopique', groupe: 'peau' }
  ],
  'Cheveux': [
    { key: 'hair', label: 'Type de cheveux', exemple: 'Ex. bouclés, fins', groupe: 'cheveux' }
  ],
  'Mode': [
    { key: 'sizeUsual', label: 'Taille habituelle', exemple: 'Ex. 38', groupe: 'tailles' },
    { key: 'sizeOrdered', label: 'Taille commandée', exemple: 'Ex. 38', groupe: 'tailles' }
  ],
  'Chaussures & sacs': [
    { key: 'sizeUsual', label: 'Pointure habituelle', exemple: 'Ex. 38', groupe: 'tailles' },
    { key: 'sizeOrdered', label: 'Pointure commandée', exemple: 'Ex. 38', groupe: 'tailles' }
  ],
  'Parfums': [
    { key: 'occasion', label: 'Occasion', exemple: 'Ex. tous les jours, soirées', groupe: 'occasion' }
  ]
};

/** Critères notés d'une catégorie : [['quality','Qualité du produit'], …] */
export function criteresNotes(categorie) {
  return NOTES[categorie] || NOTES_PAR_DEFAUT;
}

/** Champs texte pertinents d'une catégorie (peut être vide). */
export function criteresTextes(categorie) {
  return TEXTES[categorie] || [];
}

/** Les champs texte regroupés pour l'affichage : [ [champ], [champ, champ] ] */
export function groupesTextes(categorie) {
  const groupes = [];
  for (const champ of criteresTextes(categorie)) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier[0].groupe === champ.groupe) dernier.push(champ);
    else groupes.push([champ]);
  }
  return groupes;
}

/** Toutes les clés autorisées pour une catégorie (notes + texte).
    Le serveur s'en sert pour refuser les critères inventés. */
export function clesCriteres(categorie) {
  return [
    ...criteresNotes(categorie).map(([cle]) => cle),
    ...criteresTextes(categorie).map(champ => champ.key)
  ];
}

/** Valeur lisible d'un champ texte (pour l'affichage) : on range en minuscules. */
function normaliser(valeur) {
  return String(valeur).trim().replace(/\s+/g, ' ').slice(0, 60);
}

/** Agrège les déclarations texte des avis d'un produit.
    Exemple concret : trois avis sur une crème avec « mixte », « Mixte » et
    « sèche » donnent : { key:'skin', label:'Type de peau', valeurs:[{valeur:'mixte',n:2},{valeur:'sèche',n:1}] } */
export function declarations(reviews, categorie) {
  return criteresTextes(categorie).map(champ => {
    const compteur = new Map();
    for (const avis of reviews || []) {
      const brut = avis?.criteria?.[champ.key];
      if (typeof brut !== 'string') continue;
      const valeur = normaliser(brut);
      if (!valeur) continue;
      const cle = valeur.toLowerCase();
      const existant = compteur.get(cle);
      if (existant) existant.n += 1;
      else compteur.set(cle, { valeur, n: 1 });
    }
    const valeurs = [...compteur.values()].sort((a, b) => b.n - a.n);
    return { key: champ.key, label: champ.label, valeurs };
  }).filter(champ => champ.valeurs.length > 0);
}
