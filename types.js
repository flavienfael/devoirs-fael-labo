/* Cahiers de Faël — formats d'exercice ajoutés par Claude en supervision (LABO).
   Ce fichier est le SEUL endroit où un nouveau format s'ajoute : app.js n'a pas à changer.
   Un format n'apparaît dans l'appli que s'il est aussi déclaré dans l'onglet « Types » du tableur LABO
   (statut essai ou adopté) ; « abandonné » le masque sans rien casser.

   window.CF_TYPES['cle'] = {
     nom: 'Relier',                 // nom affiché aux parents
     icone: '🔗',
     aide: 'Relier deux colonnes',  // une ligne pour les parents
     questions(donnees, o) {        // obligatoire : transforme les données (JSON rendu par Mistral) en questions
       return [{ cle: 'x:1', mode: 'monmode', diff: 1, consigne: 'Touche…', enonce: '', dire: [{ texte: '…' }],
                 bonne: '…', aide: 'coup de pouce sans la réponse', explication: 'la règle en une phrase' }];
     },
     defis(donnees, o) { return [...] }   // facultatif : 2-3 questions difficiles, sans aide
   };
   window.CF_MODES['monmode'] = function (q, o) {
     // dessine la zone de réponse dans o.zone, puis appelle o.repondre(valeur, boutonOuNull) UNE fois.
     // Juste si valeur === q.bonne, ou si q.juste(valeur) renvoie true. Mettre data-v = valeur sur les boutons
     // permet à l'appli de surligner la bonne réponse après une erreur.
   };
   o = { el, dire, melange, norm, riche, zone, repondre }
   Règles absolues : aucun mot ni phrase à taper au clavier (nombres permis), cibles larges (≥ 48 px),
   coup de pouce qui ne donne jamais la réponse, une seule action par question. */
window.CF_TYPES = window.CF_TYPES || {};
window.CF_MODES = window.CF_MODES || {};
