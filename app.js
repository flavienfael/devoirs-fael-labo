/* Cahiers de Faël — appli unique (LABO, version 1, 08/11/2026).
   Une seule appli : l'espace de Faël (séances, devoirs du jour, étoiles) et l'espace parents
   (contenus saisis directement ou préparés par Mistral, devoirs, étoiles, journal, réglages, conseils).
   Les données vivent dans le « Moteur LABO » (Apps Script + tableur privé) ; rien de personnel n'est écrit dans ce fichier public. */
(function () {
  'use strict';

  /* ---------- Outils ---------- */
  const $ = s => document.querySelector(s);
  function el(t, p, ...k) {
    const e = document.createElement(t);
    if (p) for (const a in p) { const v = p[a]; if (v == null || v === false) continue;
      if (a === 'class') e.className = v; else if (a === 'text') e.textContent = v; else if (a === 'html') e.innerHTML = v;
      else if (a.startsWith('on')) e.addEventListener(a.slice(2), v); else e.setAttribute(a, v === true ? '' : v); }
    k.flat(Infinity).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cf.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").toLowerCase();
  const propre = s => String(s || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const melange = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const jour = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const plusJours = n => { const d = new Date(); d.setDate(d.getDate() + n); return jour(d); };
  function toast(msg, err) { const t = el('div', { class: 'toast' + (err ? ' err' : ''), role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.remove(), err ? 5000 : 2400); }
  /* Gras des mots-clés : **mot** dans une consigne */
  function riche(txt) { return String(txt || '').split(/(\*\*[^*]+\*\*)/).map(p => /^\*\*.+\*\*$/.test(p) ? el('strong', { text: p.slice(2, -2) }) : p); }
  function surligne(texte, mots) {
    texte = String(texte || ''); if (!mots.length) return [texte];
    const n = norm(texte), on = new Array(texte.length).fill(false);
    mots.forEach(m => { let i = n.indexOf(m); while (i >= 0) { for (let k = i; k < i + m.length; k++) on[k] = true; i = n.indexOf(m, i + m.length); } });
    const out = []; let i = 0;
    while (i < texte.length) { const v = on[i]; let j = i; while (j < texte.length && on[j] === v) j++; out.push(v ? el('mark', { text: texte.slice(i, j) }) : texte.slice(i, j)); i = j; }
    return out;
  }

  /* ---------- Voix ---------- */
  let voixListe = [];
  function chargerVoix() { try { voixListe = speechSynthesis.getVoices(); } catch (e) { voixListe = []; } }
  if ('speechSynthesis' in window) { chargerVoix(); speechSynthesis.onvoiceschanged = chargerVoix; }
  function dire(morceaux) {
    if (!('speechSynthesis' in window) || !R().voix) return;
    speechSynthesis.cancel();
    morceaux.filter(m => m && m.texte).forEach(m => {
      const u = new SpeechSynthesisUtterance(m.texte.replace(/\*\*/g, '').replace(/_{2,}|…/g, ' blanc '));
      u.lang = m.lang || 'fr-FR'; u.rate = m.lang && m.lang.startsWith('en') ? 0.85 : 0.9;
      const v = voixListe.find(x => x.lang === u.lang) || voixListe.find(x => x.lang && x.lang.startsWith(u.lang.slice(0, 2)));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    });
  }

  /* ---------- Moteur (Apps Script) ---------- */
  let D = store.get('donnees', null);
  const R = () => Object.assign({ taille: 5, series: 2, pauses: true, dureePause: 45, voix: true, calme: true, codeParents: '' }, (D && D.reglages) || {});
  async function api(action, args) {
    const cfg = store.get('cfg', null);
    if (!cfg || !cfg.url) throw new Error('L\'appli n\'est pas encore reliée à son moteur.');
    const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ jeton: cfg.jeton, action, args: args || {} }) });
    if (!r.ok) throw new Error('Le moteur ne répond pas (' + r.status + ').');
    const j = await r.json();
    if (!j.ok) throw new Error(j.erreur || 'Erreur du moteur.');
    return j.resultat;
  }
  async function charger() {
    try { D = await api('demarrer'); store.set('donnees', D); await viderFile(); return true; }
    catch (e) { if (!D) throw e; toast('Hors ligne : je travaille avec la dernière copie.', true); return false; }
  }
  /* File d'attente des résultats (si le réseau manque) */
  async function envoyer(paquet) {
    const file = store.get('file', []); file.push(paquet); store.set('file', file);
    await viderFile();
  }
  async function viderFile() {
    let file = store.get('file', []);
    while (file.length) {
      try { const r = await api('envoyerResultats', file[0]); if (D && r) { D.etoiles = r.etoiles; store.set('donnees', D); } }
      catch (e) { return; }
      file.shift(); store.set('file', file);
    }
  }

  /* ---------- Génération des questions ---------- */
  const PRONOMS = ['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles'];
  const pron = (p, forme) => p === 'je' && /^[aeiouyhéèêâ]/i.test(forme) ? "j'" : p + ' ';
  /* Fautes plausibles d'un élève de CE2 (pour les choix d'orthographe) */
  const FAUTES = [[/([bcdfglmnprst])\1/, '$1'], [/([aeiouéè])([lmnprst])([aeiouéè])/, '$1$2$2$3'], [/[tdsxp]$/, ''],
    [/é$/, 'er'], [/é$/, 'ez'], [/ée$/, 'é'], [/er$/, 'é'], [/è/, 'ai'], [/ai/, 'è'], [/ai(?!n)/, 'é'],
    [/en/, 'an'], [/an/, 'en'], [/em/, 'am'], [/am/, 'em'], [/ain/, 'in'], [/ein/, 'in'], [/eau/, 'o'], [/au/, 'o'],
    [/c([aou])/, 'qu$1'], [/ph/, 'f'], [/(^|[^f])f(?!f)/, '$1ph'], [/([aeiou])s([aeiou])/, '$1z$2'], [/eur$/, 'eure'], [/ent(s?)$/, 'ant$1'],
    [/mps$/, 'ns'], [/[éèê]/, 'e'], [/gu([ei])/, 'g$1'], [/ç/, 'c']];
  function variantes(mot) {
    const morceaux = mot.split(' '), w = morceaux.pop(), avant = morceaux.length ? morceaux.join(' ') + ' ' : '';
    const c = new Set();
    FAUTES.forEach(([re, f]) => { const v = w.replace(re, f); if (v !== w && v.length > 1) c.add(v); });
    return melange([...c]).slice(0, 2).map(v => avant + v);
  }
  function questions(c) {
    const d = c.donnees || {}, out = [];
    if (c.type === 'mots') {
      (d.mots || []).forEach(m => {
        const mot = String(m.mot || '').trim(); if (!mot) return;
        const nom = mot.replace(/^(un|une|des|le|la|les)\s+|^l'/i, ''), n = nom.length;
        const trou = m.phrase && norm(m.phrase).includes(norm(nom)) ? m.phrase.replace(new RegExp(nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '____') : '____';
        out.push({ cle: 'e:' + mot, mode: 'saisie', diff: n, accepte: [mot],
          consigne: '**Écoute** et **écris** le mot qui manque.', enonce: trou,
          dire: [{ texte: mot }, m.phrase ? { texte: m.phrase } : null, { texte: nom }], bonne: nom,
          aide: 'Le mot commence par « ' + nom.slice(0, 2) + ' » et a ' + n + ' lettres.',
          explication: 'On écrit : ' + mot + '.' });
        const fautes = variantes(mot);
        if (fautes.length) out.push({ cle: 'c:' + mot, mode: 'choix', diff: n - 3,
          consigne: 'Choisis le mot **bien écrit**.', enonce: 'Quel mot est bien écrit ?', dire: [{ texte: mot }],
          choix: melange([mot, ...fautes]), bonne: mot,
          aide: 'Écoute le mot, puis regarde chaque lettre, surtout la fin.', explication: 'On écrit : ' + mot + '.' });
      });
    } else if (c.type === 'conjugaison') {
      const f = d.formes || {}, verbe = d.verbe || 'le verbe', temps = d.temps || 'présent';
      const valeurs = [...new Set(Object.values(f).filter(Boolean))];
      PRONOMS.filter(p => f[p]).forEach(p => {
        const forme = f[p], diff = ['nous', 'vous'].includes(p) ? 2 : ['ils', 'elles'].includes(p) ? 3 : 1;
        const fin = forme.slice(-Math.min(3, Math.max(2, forme.length - 2)));
        const autres = melange(valeurs.filter(v => v !== forme)).slice(0, 3);
        out.push({ cle: 'c:' + p, mode: 'choix', diff,
          consigne: 'Choisis la bonne forme du verbe **' + verbe + '** au ' + temps + '.', enonce: pron(p, forme) + '____', dire: [{ texte: p }],
          choix: melange([forme, ...autres]), bonne: forme,
          aide: 'Avec « ' + p + ' », la fin du verbe s\'écrit « …' + fin + ' ».', explication: pron(p, forme) + forme + '.' });
        out.push({ cle: 'e:' + p, mode: 'saisie', diff: diff + 1,
          consigne: '**Écris** le verbe **' + verbe + '** au ' + temps + '.', enonce: pron(p, forme) + '____', dire: [{ texte: p }],
          bonne: forme, aide: 'Avec « ' + p + ' », la fin du verbe s\'écrit « …' + fin + ' ».', explication: pron(p, forme) + forme + '.' });
      });
    } else if (c.type === 'vocabulaire') {
      const paires = (d.paires || []).filter(p => p.fr && p.en), lang = /anglais/i.test(d.langue || 'anglais') ? 'en-GB' : 'fr-FR';
      paires.forEach((p, i) => {
        const autresEn = melange(paires.filter(x => x !== p)).slice(0, 2).map(x => x.en), autresFr = melange(paires.filter(x => x !== p)).slice(0, 2).map(x => x.fr);
        out.push({ cle: 'fe:' + p.fr, mode: 'choix', diff: i % 3,
          consigne: 'Comment dit-on en **anglais** ?', enonce: p.fr, dire: [{ texte: p.fr }],
          choix: melange([p.en, ...autresEn]), bonne: p.en, direChoix: lang,
          aide: 'Le mot anglais commence par « ' + p.en.replace(/^(a|an|the)\s+/i, '').slice(0, 1) + ' ».', explication: p.fr + ' se dit « ' + p.en + ' ».' });
        out.push({ cle: 'ef:' + p.en, mode: 'choix', diff: 1 + i % 3,
          consigne: '**Écoute** et choisis le mot en **français**.', enonce: p.en, dire: [{ texte: p.en, lang }],
          choix: melange([p.fr, ...autresFr]), bonne: p.fr,
          aide: 'Réécoute le mot. Pense à ta trousse et à ton cartable.', explication: '« ' + p.en + ' » veut dire ' + p.fr + '.' });
      });
    } else if (c.type === 'qcm') {
      (d.questions || []).forEach((q, i) => {
        const choix = (q.choix || []).filter(Boolean); if (choix.length < 2) return;
        const bonne = choix[Math.min(Number(q.bonne) || 0, choix.length - 1)];
        out.push({ cle: 'q:' + i, mode: 'choix', diff: i, consigne: q.consigne || 'Choisis la bonne réponse.', enonce: q.question || '', dire: [{ texte: q.question }],
          choix: melange(choix), bonne, aide: q.aide || 'Relis la question doucement, puis élimine les réponses impossibles.', explication: q.explication || ('La bonne réponse est : ' + bonne + '.') });
      });
    }
    return out;
  }
  const estJuste = (q, rep) => q.mode === 'saisie' ? [q.bonne, ...(q.accepte || [])].some(b => propre(rep) === propre(b)) : rep === q.bonne;

  /* Erreurs à revoir (répétition espacée : J+1, J+3, J+7) */
  const ECARTS = [1, 3, 7];
  function noterErreur(cid, cle) { const e = store.get('erreurs', {}); e[cid + '|' + cle] = { cid, cle, etape: 0, due: plusJours(1) }; store.set('erreurs', e); }
  function noterReussite(cid, cle) {
    const e = store.get('erreurs', {}), k = cid + '|' + cle, x = e[k]; if (!x) return;
    x.etape++; if (x.etape >= ECARTS.length) delete e[k]; else x.due = plusJours(ECARTS[x.etape]);
    store.set('erreurs', e);
  }
  const erreursDues = cid => Object.values(store.get('erreurs', {})).filter(x => x.cid === cid && x.due <= jour());

  /* ---------- Rendu général ---------- */
  const app = () => $('#app');
  function page(...k) { app().replaceChildren(el('div', { class: 'wrap' }, ...k)); window.scrollTo(0, 0); document.body.classList.toggle('calme', !!R().calme); }
  function tete(titre, retour, droite) {
    return el('header', { class: 'tete' }, el('div', { class: 'gauche' }, retour ? el('a', { class: 'rond', href: retour, 'aria-label': 'Retour', text: '‹' }) : null, el('h1', { text: titre })), droite || null);
  }
  const badgeEtoiles = () => el('span', { class: 'etoiles', 'aria-label': (D ? D.etoiles : 0) + ' étoiles' }, el('b', { text: '★' }), String(D ? D.etoiles || 0 : 0));
  const ICONES = { mots: '✏️', conjugaison: '🔤', vocabulaire: '🇬🇧', qcm: '✅' };
  const TYPES = { mots: 'Mots à écrire', conjugaison: 'Conjugaison', vocabulaire: 'Vocabulaire', qcm: 'Questions' };
  const MATIERES = ['Français', 'Mathématiques', 'Anglais', 'Questionner le monde'];
  const contenus = statut => (D ? D.contenus : []).filter(c => !statut || c.statut === statut);
  const contenu = id => (D ? D.contenus : []).find(c => String(c.id) === String(id));

  /* ---------- Premier lancement : relier au moteur ---------- */
  function ecranRelier() {
    const cfg = store.get('cfg', {}) || {};
    const url = el('input', { type: 'url', value: cfg.url || '', placeholder: 'https://script.google.com/macros/s/…/exec' });
    const jet = el('input', { type: 'password', value: cfg.jeton || '', autocomplete: 'off', placeholder: 'Code d\'accès' });
    const go = el('button', { class: 'btn plein large', type: 'button', text: 'Relier l\'appli', onclick: async () => {
      store.set('cfg', { url: url.value.trim(), jeton: jet.value.trim() });
      go.disabled = true; go.textContent = 'Vérification…';
      try { await charger(); toast('Appli reliée.'); location.hash = '#/'; }
      catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Relier l\'appli'; }
    } });
    page(tete('Relier l\'appli', D ? '#/parents' : null),
      el('section', { class: 'carte' }, el('p', { text: 'À faire une seule fois sur chaque appareil. Ces informations restent sur cet appareil.' }),
        el('label', { class: 'champ' }, 'Adresse du moteur', el('span', { class: 'aide-champ', text: 'L\'adresse de l\'application Web « Moteur LABO », qui finit par /exec.' }), url),
        el('label', { class: 'champ', style: 'margin-top:12px' }, 'Code d\'accès', el('span', { class: 'aide-champ', text: 'Affiché dans le journal d\'exécution de setup().' }), jet),
        el('div', { style: 'margin-top:16px' }, go)));
  }

  /* ---------- Espace de Faël ---------- */
  let filtre = { q: '', matiere: '' };
  function ecranAccueil() {
    const valides = contenus('validé');
    const q = el('input', { type: 'search', placeholder: 'Chercher : dictée, conjugaison, anglais…', 'aria-label': 'Chercher un exercice', value: filtre.q, autocomplete: 'off', enterkeyhint: 'search' });
    const x = el('button', { class: 'x', type: 'button', 'aria-label': 'Effacer', text: '✕', hidden: !filtre.q });
    const liste = el('div', { class: 'liste' });
    const chips = el('div', { class: 'chips' });
    const mats = MATIERES.filter(m => valides.some(c => c.matiere === m)).concat([...new Set(valides.map(c => c.matiere))].filter(m => !MATIERES.includes(m)));
    function dessiner() {
      chips.replaceChildren(...['Tout', ...mats].map(m => el('button', { type: 'button', 'aria-pressed': String((m === 'Tout' ? '' : m) === filtre.matiere), text: m, onclick: () => { filtre.matiere = m === 'Tout' ? '' : m; dessiner(); } })));
      const mots = norm(filtre.q).split(/\s+/).filter(Boolean);
      const ok = c => (!filtre.matiere || c.matiere === filtre.matiere) && mots.every(m => norm([c.titre, c.matiere, c.theme, TYPES[c.type]].join(' ')).includes(m));
      const blocs = [];
      mats.forEach(m => {
        const dans = valides.filter(c => c.matiere === m && ok(c)); if (!dans.length) return;
        blocs.push(el('p', { class: 'matiere', text: m }));
        [...new Set(dans.map(c => c.theme))].sort((a, b) => a.localeCompare(b, 'fr')).forEach(t => {
          blocs.push(el('h3', {}, surligne(t, mots)));
          dans.filter(c => c.theme === t).forEach(c => blocs.push(el('a', { class: 'tuile', href: '#/seance/' + c.id },
            el('span', { class: 'ic', 'aria-hidden': 'true', text: ICONES[c.type] || '📘' }),
            el('span', {}, el('span', { class: 't' }, surligne(c.titre, mots)), el('span', { class: 's', text: TYPES[c.type] || '' })),
            el('span', { class: 'fl', text: '›' }))));
        });
      });
      liste.replaceChildren(...(blocs.length ? blocs : [el('p', { class: 'vide', text: valides.length ? 'Rien trouvé. Essaie un autre mot.' : 'Pas encore d\'exercice. Un parent peut en ajouter dans l\'espace parents.' })]));
    }
    q.addEventListener('input', () => { filtre.q = q.value; x.hidden = !q.value; dessiner(); });
    x.onclick = () => { q.value = ''; filtre.q = ''; x.hidden = true; dessiner(); q.focus(); };
    const dj = (D.devoirs || []).filter(d => d.date === jour() && d.statut !== 'archivé');
    page(tete('Mes cahiers', null, badgeEtoiles()),
      dj.map(d => el('a', { class: 'tuile', href: '#/devoirs/' + d.id, style: 'border:2px solid var(--accent)' },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: '📋' }), el('span', {}, el('span', { class: 't', text: d.titre || 'Mes devoirs du jour' }), el('span', { class: 's', text: avancement(d) })), el('span', { class: 'fl', text: '›' }))),
      el('div', { class: 'recherche', role: 'search' }, el('span', { class: 'loupe', 'aria-hidden': 'true', text: '🔍' }), q, x),
      chips, liste,
      el('a', { class: 'btn discret large', href: '#/parents', text: 'Espace parents' }));
    dessiner();
  }

  /* ---------- Séance ---------- */
  function ecranSeance(id, test) {
    const c = contenu(id);
    if (!c) { page(tete('Exercice', '#/'), el('p', { class: 'vide', text: 'Exercice introuvable.' })); return; }
    const pool = questions(c);
    if (!pool.length) { page(tete(c.titre, '#/'), el('p', { class: 'vide', text: 'Cet exercice est vide.' })); return; }
    const r = R();
    /* Échauffement : erreurs à revoir, puis séries ; chaque série commence par la question la plus facile */
    const dues = test ? [] : erreursDues(c.id).slice(0, 3).map(e => pool.find(q => q.cle === e.cle)).filter(Boolean);
    const restantes = melange(pool.filter(q => !dues.includes(q)));
    const series = [];
    for (let s = 0; s < r.series && restantes.length; s++) {
      const lot = restantes.splice(0, r.taille);
      lot.sort((a, b) => a.diff - b.diff); const [premier, ...reste] = lot; series.push([premier, ...melange(reste)]);
    }
    if (dues.length) series.unshift(dues.map(q => Object.assign({}, q, { revoir: true })));
    const etat = { s: 0, i: 0, essai: 1, journal: [], etoiles: 0, debut: Date.now(), tq: Date.now() };
    const retour = test ? '#/p/contenu/' + c.id : '#/';

    function lecon() {
      const cartes = (c.donnees.retiens || []).filter(x => x && (x.titre || x.texte));
      if (!cartes.length) return question();
      let k = 0;
      const zone = el('div');
      const afficher = () => {
        const ca = cartes[k];
        zone.replaceChildren(el('div', { class: 'retiens' },
          el('div', { class: 'carte-lecon' }, el('b', { text: ca.titre || 'Je retiens' }), el('p', { text: ca.texte || '' }), ca.exemple ? el('p', { class: 'ex', text: ca.exemple }) : null),
          el('p', { class: 'muted petit', text: 'Carte ' + (k + 1) + ' sur ' + cartes.length })),
          el('div', { class: 'outils' }, el('button', { class: 'btn discret', type: 'button', text: '🔊 Écouter', onclick: () => dire([{ texte: (ca.titre || '') + '. ' + (ca.texte || '') + '. ' + (ca.exemple || '') }]) })),
          el('div', { class: 'rangee', style: 'margin-top:14px' },
            k > 0 ? el('button', { class: 'btn', type: 'button', text: '‹ Avant', onclick: () => { k--; afficher(); } }) : null,
            k < cartes.length - 1 ? el('button', { class: 'btn plein', type: 'button', text: 'Carte suivante ›', onclick: () => { k++; afficher(); } })
              : el('button', { class: 'btn plein', type: 'button', text: 'Je commence', onclick: question })));
      };
      page(tete(c.titre, retour, badgeEtoiles()), el('section', { class: 'carte cahier' }, el('h2', { text: 'Je retiens' }), zone),
        el('button', { class: 'btn discret large', type: 'button', text: 'Passer la leçon', onclick: question }));
      afficher();
    }

    function question() {
      const lot = series[etat.s], q = lot[etat.i];
      etat.essai = 1; etat.tq = Date.now();
      const points = el('div', { class: 'points', 'aria-hidden': 'true' }, lot.map((_, k) => el('i', { class: k < etat.i ? 'fait' : k === etat.i ? 'cours' : '' })));
      const libSerie = q.revoir ? 'Je revois mes erreurs' : 'Série ' + (etat.s + 1 - (series[0][0] && series[0][0].revoir ? 1 : 0)) + ' sur ' + series.filter(l => !l[0].revoir).length;
      const zoneRep = el('div'), zoneRetour = el('div'), zoneAide = el('div');
      const ecouter = () => dire([{ texte: q.consigne }, ...(q.dire || [])]);
      const outils = el('div', { class: 'outils' },
        el('button', { class: 'btn discret', type: 'button', text: '🔊 Écouter', onclick: ecouter }),
        el('button', { class: 'btn discret', type: 'button', text: '💡 Coup de pouce', onclick: () => zoneAide.replaceChildren(el('div', { class: 'aide' }, el('b', { text: 'Coup de pouce : ' }), q.aide)) }),
        D.mistral ? el('button', { class: 'btn discret', type: 'button', text: 'Explique-moi autrement', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; zoneAide.replaceChildren(el('div', { class: 'aide', text: 'Je cherche une autre façon d\'expliquer…' }));
          try { const r2 = await api('expliquerAutrement', { consigne: q.consigne.replace(/\*\*/g, ''), question: q.enonce, explication: q.aide }); zoneAide.replaceChildren(el('div', { class: 'aide' }, r2.texte)); }
          catch (e) { zoneAide.replaceChildren(el('div', { class: 'aide', text: 'Pas d\'explication pour l\'instant : utilise le coup de pouce.' })); }
          b.disabled = false; } }) : null);
      function repondre(rep, bouton) {
        const juste = estJuste(q, rep);
        etat.journal.push({ contenu: c.id, question: q.cle, reponse: rep, juste, essai: etat.essai, duree_s: Math.round((Date.now() - etat.tq) / 1000) });
        if (juste) {
          etat.etoiles++; if (q.revoir) noterReussite(c.id, q.cle);
          if (bouton) bouton.classList.add('juste');
          verrouiller();
          zoneRetour.replaceChildren(el('div', { class: 'retour ok', role: 'status' },
            el('b', { class: 'titre', text: etat.essai === 1 ? 'Bravo !' : 'Bien rattrapé !' }), el('span', { class: 'plus1', text: '+1 étoile ★' }), el('span', { text: q.explication }),
            el('button', { class: 'btn plein', type: 'button', text: 'Continuer', onclick: suivant })));
          zoneRetour.querySelector('button').focus();
        } else if (etat.essai === 1) {
          etat.essai = 2;
          if (bouton) { bouton.classList.add('faux'); bouton.disabled = true; }
          zoneAide.replaceChildren(el('div', { class: 'aide' }, el('b', { text: 'Coup de pouce : ' }), q.aide));
          zoneRetour.replaceChildren(el('div', { class: 'retour info', role: 'status' }, el('b', { class: 'titre', text: 'Presque !' }), el('span', { text: 'Lis le coup de pouce et essaie encore une fois.' })));
          const inp = zoneRep.querySelector('input'); if (inp) { inp.select(); inp.focus(); }
        } else {
          if (!test) noterErreur(c.id, q.cle);
          if (bouton) bouton.classList.add('faux');
          verrouiller(true);
          zoneRetour.replaceChildren(el('div', { class: 'retour ko', role: 'status' },
            el('b', { class: 'titre', text: 'On regarde ensemble' }), el('span', {}, 'La bonne réponse : ', el('b', { text: q.bonne })), el('span', { text: q.explication }),
            el('span', { class: 'muted petit', text: 'Cette question reviendra demain pour t\'entraîner.' }),
            el('button', { class: 'btn plein', type: 'button', text: 'Continuer', onclick: suivant })));
        }
      }
      function verrouiller(montrer) {
        zoneRep.querySelectorAll('button,input').forEach(b => { b.disabled = true; if (montrer && b.dataset.v === q.bonne) b.classList.add('juste'); });
      }
      if (q.mode === 'choix') {
        zoneRep.replaceChildren(el('div', { class: 'choix' + (q.choix.some(x => x.length > 22) ? ' un' : '') },
          q.choix.map(ch => el('button', { class: 'btn', type: 'button', 'data-v': ch, text: ch, onclick: e => { if (q.direChoix) dire([{ texte: ch, lang: q.direChoix }]); repondre(ch, e.currentTarget); } }))));
      } else {
        const inp = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Ta réponse' });
        const val = el('button', { class: 'btn plein', type: 'button', text: 'Valider', onclick: () => { if (inp.value.trim()) repondre(inp.value.trim(), null); else inp.focus(); } });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') val.click(); });
        zoneRep.replaceChildren(el('div', { class: 'saisie' }, inp, el('p', { class: 'muted petit', text: 'Avant de valider, je relis mon mot lettre par lettre.' }), val));
        setTimeout(() => inp.focus(), 60);
      }
      page(tete(c.titre, retour, badgeEtoiles()),
        el('div', { class: 'progression' }, el('span', { text: libSerie }), points),
        el('section', { class: 'carte cahier' },
          el('p', { class: 'consigne' }, el('span', { class: 'lib', text: 'Consigne' }), ' : ', riche(q.consigne)),
          el('p', { class: 'enonce' }, q.enonce.split('____').map((p, k, a) => [p, k < a.length - 1 ? el('span', { class: 'trou', 'aria-label': 'à compléter' }) : null])),
          outils, zoneAide, zoneRep, zoneRetour));
      if (R().voix && etat.i === 0) setTimeout(ecouter, 300);
    }

    function suivant() {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      etat.i++;
      if (etat.i < series[etat.s].length) return question();
      etat.s++; etat.i = 0;
      if (etat.s >= series.length) return bilan();
      if (R().pauses && !series[etat.s - 1][0].revoir) return pause();
      question();
    }

    const BOUGER = ['Saute 10 fois sur place.', 'Étire-toi très haut, puis touche tes pieds. Trois fois.', 'Fais 5 grands moulins avec les bras.', 'Marche comme un robot jusqu\'à la porte et reviens.', 'Bois un verre d\'eau, puis respire 3 fois très lentement.', 'Fais l\'avion sur un pied, puis sur l\'autre.'];
    function pause() {
      const total = Number(R().dureePause) || 45, act = BOUGER[Math.floor(Math.random() * BOUGER.length)];
      let reste = total; const C = 2 * Math.PI * 62;
      const svg = anneau(C), arcNs = svg.querySelector('.reste'), txtNs = svg.querySelector('text'); txtNs.textContent = reste;
      const fini = el('button', { class: 'btn plein large', type: 'button', text: 'J\'ai bougé, je continue', onclick: () => { clearInterval(t); question(); } });
      page(tete('Pause qui bouge', null, badgeEtoiles()), el('section', { class: 'carte pause' }, el('span', { class: 'grand', 'aria-hidden': 'true', text: '🤸' }), el('p', { class: 'enonce', text: act }), svg, fini));
      dire([{ texte: 'Pause qui bouge. ' + act }]);
      const t = setInterval(() => { reste--; txtNs.textContent = Math.max(0, reste); arcNs.setAttribute('stroke-dashoffset', C * (1 - reste / total)); if (reste <= 0) { clearInterval(t); dire([{ texte: 'C\'est reparti !' }]); } }, 1000);
    }

    function bilan() {
      const j = etat.journal, premiers = j.filter(x => x.essai === 1 && x.juste).length, seconds = j.filter(x => x.essai === 2 && x.juste).length;
      const total = series.reduce((s, l) => s + l.length, 0);
      const bonus = test ? 0 : 2; const gagne = etat.etoiles + bonus;
      const phrase = premiers + seconds === total ? 'Tout juste ! Tu as été très concentré.' :
        seconds ? 'Tu as trouvé ' + (premiers + seconds) + ' réponses sur ' + total + ', dont ' + seconds + ' grâce au coup de pouce : bien joué d\'avoir réessayé.' :
        'Tu as trouvé ' + premiers + ' réponses sur ' + total + '. Les autres reviendront pour t\'entraîner.';
      if (!test) envoyer({ resultats: j.map(x => Object.assign({ horodatage: new Date().toISOString().slice(0, 19).replace('T', ' ') }, x)), etoiles: gagne, motif: 'Séance : ' + c.titre })
        .then(() => { const b = $('.etoiles'); if (b && D) b.lastChild.textContent = String(D.etoiles); });
      if (D && !test) { D.etoiles = (D.etoiles || 0) + gagne; store.set('donnees', D); }
      page(tete('Bilan', retour, badgeEtoiles()), el('section', { class: 'carte bilan' },
        el('h2', { text: 'Séance terminée' }), el('span', { class: 'gros', text: '+' + gagne + ' ★' }),
        el('p', { text: phrase }), bonus ? el('p', { class: 'muted petit', text: 'Dont 2 étoiles bonus pour avoir fini la séance.' }) : el('p', { class: 'muted petit', text: 'Mode essai : rien n\'est enregistré.' }),
        el('a', { class: 'btn plein large', href: retour, text: test ? 'Retour au contenu' : 'Retour à mes cahiers' })));
      dire([{ texte: 'Séance terminée. ' + phrase }]);
    }

    lecon();
  }

  function anneau(C) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 150 150'); svg.setAttribute('class', 'anneau'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle class="fond" cx="75" cy="75" r="62"></circle><circle class="reste" cx="75" cy="75" r="62" stroke-dasharray="' + C + '" stroke-dashoffset="0" transform="rotate(-90 75 75)"></circle><text x="75" y="85" text-anchor="middle"></text>';
    return svg;
  }

  /* ---------- Mes devoirs du jour (Faël) ---------- */
  const faitsDevoirs = id => store.get('devoirs.' + id, []);
  function avancement(d) { const n = (d.etapes || []).length, f = faitsDevoirs(d.id).length; return n ? f + ' étape' + (f > 1 ? 's' : '') + ' sur ' + n : 'Aucune étape'; }
  function ecranDevoirs(id) {
    const d = (D.devoirs || []).find(x => String(x.id) === String(id));
    if (!d) { page(tete('Mes devoirs', '#/'), el('p', { class: 'vide', text: 'Introuvable.' })); return; }
    const faits = faitsDevoirs(d.id);
    page(tete(d.titre || 'Mes devoirs du jour', '#/', badgeEtoiles()),
      el('p', { class: 'muted', text: 'Une étape à la fois. Quand c\'est fait, je coche : +2 étoiles.' }),
      el('div', { class: 'liste' }, (d.etapes || []).map((e, k) => el('button', { class: 'case' + (faits.includes(k) ? ' fait' : ''), type: 'button', onclick: () => ecranEtape(d, k) },
        el('span', { class: 'coche', text: faits.includes(k) ? '✓' : '' }), el('span', {}, el('span', { class: 't', text: e.texte }), el('span', { class: 's muted petit', style: 'display:block', text: (e.minutes ? e.minutes + ' min' : '') + (e.contenu ? ' · exercice dans l\'appli' : '') }))))));
  }
  function ecranEtape(d, k) {
    const e = d.etapes[k], total = (Number(e.minutes) || 10) * 60;
    let reste = total, t = null;
    const C = 2 * Math.PI * 62;
    const svg = anneau(C);
    const arc = svg.querySelector('.reste'), txt = svg.querySelector('text');
    const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    txt.textContent = fmt(reste);
    const lancer = el('button', { class: 'btn', type: 'button', text: 'Je lance le minuteur', onclick: () => {
      if (t) return; lancer.disabled = true;
      t = setInterval(() => { reste--; txt.textContent = fmt(Math.max(0, reste)); arc.setAttribute('stroke-dashoffset', C * (1 - reste / total)); if (reste <= 0) { clearInterval(t); dire([{ texte: 'Le temps est écoulé. Tu peux faire une pause.' }]); } }, 1000);
    } });
    const fini = el('button', { class: 'btn ok large', type: 'button', text: 'C\'est fait, je coche', onclick: () => {
      clearInterval(t); const f = faitsDevoirs(d.id); if (!f.includes(k)) { f.push(k); store.set('devoirs.' + d.id, f); envoyer({ resultats: [], etoiles: 2, motif: 'Devoirs : ' + e.texte }); if (D) { D.etoiles = (D.etoiles || 0) + 2; store.set('donnees', D); } toast('+2 étoiles ★'); }
      location.hash = '#/devoirs/' + d.id; ecranDevoirs(d.id);
    } });
    page(tete('Étape ' + (k + 1), '#/devoirs/' + d.id, badgeEtoiles()), el('section', { class: 'carte pause' },
      el('p', { class: 'enonce', text: e.texte }), svg, el('div', { class: 'rangee', style: 'width:100%' }, lancer,
        e.contenu && contenu(e.contenu) ? el('a', { class: 'btn plein', href: '#/seance/' + e.contenu, text: 'Ouvrir l\'exercice' }) : null), fini));
    dire([{ texte: e.texte }]);
  }

  /* ---------- Espace parents ---------- */
  let parentOk = false;
  function porteParents(suite) {
    const code = String(R().codeParents || '');
    if (!code || parentOk) return suite();
    const inp = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Code parents' });
    const go = () => { if (inp.value === code) { parentOk = true; suite(); } else { toast('Code incorrect.', true); inp.value = ''; } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    page(tete('Espace parents', '#/'), el('section', { class: 'carte' }, el('label', { class: 'champ' }, 'Code parents', inp),
      el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn plein large', type: 'button', text: 'Entrer', onclick: go }))));
    setTimeout(() => inp.focus(), 60);
  }
  function ecranParents() {
    const av = contenus('à valider').length;
    const t = (href, ic, titre, sous) => el('a', { class: 'tuile', href }, el('span', { class: 'ic', 'aria-hidden': 'true', text: ic }), el('span', {}, el('span', { class: 't', text: titre }), sous ? el('span', { class: 's', text: sous }) : null), el('span', { class: 'fl', text: '›' }));
    page(tete('Espace parents', '#/', el('button', { class: 'rond', type: 'button', 'aria-label': 'Actualiser', text: '↻', onclick: async () => { try { await charger(); toast('À jour.'); ecranParents(); } catch (e) { toast(e.message, true); } } })),
      el('div', { class: 'liste' },
        t('#/p/ajouter', '➕', 'Ajouter un exercice', 'Saisie directe, ou à partir d\'une photo ou d\'un texte'),
        t('#/p/contenus', '📚', 'Tous les exercices', av ? av + ' à valider' : contenus().length + ' exercices'),
        t('#/p/devoirs', '📋', 'Mes devoirs du jour', 'Préparer la liste d\'étapes de Faël'),
        t('#/p/etoiles', '★', 'Étoiles et récompenses', (D.etoiles || 0) + ' étoiles'),
        t('#/p/journal', '📝', 'Journal d\'observation', '30 secondes par jour'),
        t('#/p/conseils', '💬', 'Conseils', 'Pour accompagner Faël'),
        t('#/p/reglages', '⚙️', 'Réglages', 'Séries, pauses, voix, code parents'),
        t('anciennes-applis.html', '🗂️', 'Anciennes applis', 'Pour comparer'),
        t('#/relier', '🔗', 'Relier l\'appli au moteur', D.mistral ? 'Mistral activé' : 'Mistral pas encore activé')));
  }

  function ecranContenus() {
    const ordre = { 'à valider': 0, 'validé': 1 };
    const l = contenus().slice().sort((a, b) => (ordre[a.statut] ?? 2) - (ordre[b.statut] ?? 2) || String(a.matiere + a.theme + a.titre).localeCompare(b.matiere + b.theme + b.titre, 'fr'));
    page(tete('Tous les exercices', '#/parents'),
      el('a', { class: 'btn plein large', href: '#/p/ajouter', text: '➕ Ajouter un exercice' }),
      el('div', { class: 'liste' }, l.length ? l.map(c => el('a', { class: 'tuile', href: '#/p/contenu/' + c.id },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: ICONES[c.type] || '📘' }),
        el('span', {}, el('span', { class: 't', text: c.titre }), el('span', { class: 's', text: c.matiere + ' › ' + c.theme + ' · ' + (TYPES[c.type] || '') })),
        el('span', { class: 'badge ' + (c.statut === 'validé' ? 'ok' : 'av'), text: c.statut }))) : el('p', { class: 'vide', text: 'Aucun exercice.' })));
  }

  function ecranAjouter() {
    page(tete('Ajouter un exercice', '#/parents'),
      el('h3', { text: 'Saisie directe' }),
      el('div', { class: 'liste' }, Object.keys(TYPES).map(ty => el('a', { class: 'tuile', href: '#/p/nouveau/' + ty },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: ICONES[ty] }), el('span', {}, el('span', { class: 't', text: TYPES[ty] }), el('span', { class: 's', text: AIDES_TYPES[ty] })), el('span', { class: 'fl', text: '›' })))),
      el('h3', { text: 'Préparé par Mistral' }),
      el('a', { class: 'tuile', href: '#/p/generer' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '📷' }),
        el('span', {}, el('span', { class: 't', text: 'À partir d\'une photo ou d\'un texte' }), el('span', { class: 's', text: D.mistral ? 'Mistral lit la leçon et prépare un brouillon que vous validez' : 'Disponible quand la clé Mistral sera ajoutée' })), el('span', { class: 'fl', text: '›' })));
  }
  const AIDES_TYPES = { mots: 'Liste de mots de dictée', conjugaison: 'Un verbe, un temps, ses formes', vocabulaire: 'Mots en français et en anglais', qcm: 'Questions à choix, sur n\'importe quelle leçon' };

  /* Conversion données <-> texte saisi */
  const versTexte = {
    mots: d => (d.mots || []).map(m => m.mot + (m.phrase ? ' | ' + m.phrase : '')).join('\n'),
    vocabulaire: d => (d.paires || []).map(p => p.fr + ' = ' + p.en).join('\n'),
    qcm: d => (d.questions || []).map(q => ['? ' + q.question, ...(q.choix || []).map((ch, i) => (i === Number(q.bonne) ? '+ ' : '- ') + ch), q.aide ? '~ ' + q.aide : '', q.explication ? '! ' + q.explication : ''].filter(Boolean).join('\n')).join('\n\n'),
    retiens: d => (d.retiens || []).map(r => [r.titre, r.texte, r.exemple ? 'Ex : ' + r.exemple : ''].filter(Boolean).join('\n')).join('\n\n')
  };
  const depuisTexte = {
    mots: t => ({ mots: t.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [mot, phrase] = l.split('|').map(s => s.trim()); return phrase ? { mot, phrase } : { mot }; }) }),
    vocabulaire: t => ({ langue: 'anglais', paires: t.split('\n').map(l => l.split('=').map(s => s.trim())).filter(p => p[0] && p[1]).map(p => ({ fr: p[0], en: p[1] })) }),
    qcm: (t, consigne) => ({ questions: t.split(/\n\s*\n/).map(b => {
      const q = { consigne: consigne || 'Choisis la bonne réponse.', question: '', choix: [], bonne: 0 };
      b.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
        if (l[0] === '?') q.question = l.slice(1).trim();
        else if (l[0] === '+') { q.bonne = q.choix.length; q.choix.push(l.slice(1).trim()); }
        else if (l[0] === '-') q.choix.push(l.slice(1).trim());
        else if (l[0] === '~') q.aide = l.slice(1).trim();
        else if (l[0] === '!') q.explication = l.slice(1).trim();
        else if (!q.question) q.question = l;
      });
      return q;
    }).filter(q => q.question && q.choix.length >= 2) }),
    retiens: t => t.split(/\n\s*\n/).map(b => { const l = b.split('\n').map(s => s.trim()).filter(Boolean); if (!l.length) return null;
      const ex = l.find(s => /^ex\s*:/i.test(s)); const reste = l.filter(s => s !== ex);
      return { titre: reste[0] || '', texte: reste.slice(1).join(' '), exemple: ex ? ex.replace(/^ex\s*:\s*/i, '') : '' }; }).filter(Boolean)
  };

  let brouillon = null; /* contenu préparé par Mistral, pas encore enregistré */
  function ecranEditeur(id, typeNouveau) {
    const c = id ? contenu(id) : (brouillon && brouillon.type === typeNouveau ? brouillon : { type: typeNouveau, matiere: 'Français', theme: '', titre: '', donnees: {}, statut: 'à valider', source: 'saisie directe' });
    if (!c) { page(tete('Exercice', '#/p/contenus'), el('p', { class: 'vide', text: 'Introuvable.' })); return; }
    const d = c.donnees || {}, ty = c.type;
    const titre = el('input', { value: c.titre || '', placeholder: 'Ex. : Dictée du 9 novembre' });
    const matiere = el('select', {}, [...new Set([...MATIERES, c.matiere].filter(Boolean))].map(m => el('option', { value: m, text: m, selected: m === c.matiere })));
    const themes = [...new Set(contenus().map(x => x.theme).filter(Boolean))];
    const theme = el('input', { value: c.theme || '', list: 'themes', placeholder: 'Même nom que le dossier du Drive' });
    const dl = el('datalist', { id: 'themes' }, themes.map(t => el('option', { value: t })));
    let corps, lire;
    if (ty === 'conjugaison') {
      const verbe = el('input', { value: d.verbe || '', placeholder: 'prendre' }), temps = el('input', { value: d.temps || 'présent' });
      const champs = {}; const f = d.formes || {};
      const grille = el('div', { class: 'formes' }, PRONOMS.map(p => { champs[p] = el('input', { value: f[p] || '', 'aria-label': p, autocapitalize: 'off' }); return [el('b', { text: p }), champs[p]]; }));
      corps = [el('div', { class: 'grille2' }, el('label', { class: 'champ' }, 'Verbe', verbe), el('label', { class: 'champ' }, 'Temps', temps)), el('label', { class: 'champ' }, 'Les formes', el('span', { class: 'aide-champ', text: 'Laisser vide un pronom qu\'on ne veut pas travailler.' }), grille)];
      lire = () => { const formes = {}; PRONOMS.forEach(p => { if (champs[p].value.trim()) formes[p] = champs[p].value.trim(); }); return { verbe: verbe.value.trim(), temps: temps.value.trim() || 'présent', formes }; };
    } else {
      const consigne = el('input', { value: (d.questions && d.questions[0] && d.questions[0].consigne) || 'Choisis la bonne réponse.' });
      const ta = el('textarea', { spellcheck: 'true' }); ta.value = versTexte[ty] ? versTexte[ty](d) : '';
      const aide = { mots: 'Un mot par ligne. Facultatif : une phrase après « | ». Ex. : un cartable | Mon cartable est lourd.',
        vocabulaire: 'Une paire par ligne : français = anglais. Ex. : une règle = a ruler',
        qcm: 'Une question par bloc, blocs séparés par une ligne vide.\n? la question\n+ la bonne réponse\n- une mauvaise réponse\n- une autre mauvaise réponse\n~ un coup de pouce (facultatif)\n! l\'explication (facultatif)' }[ty];
      corps = [ty === 'qcm' ? el('label', { class: 'champ' }, 'Consigne', consigne) : null, el('label', { class: 'champ' }, 'Contenu', el('span', { class: 'aide-champ', style: 'white-space:pre-line', text: aide }), ta)];
      lire = () => depuisTexte[ty](ta.value, consigne.value.trim());
    }
    const retiens = el('textarea', { style: 'min-height:120px' }); retiens.value = versTexte.retiens(d);
    const donnees = () => Object.assign(lire(), { retiens: depuisTexte.retiens(retiens.value) });
    const objet = statut => ({ id: c.id, type: ty, titre: titre.value.trim(), matiere: matiere.value, theme: theme.value.trim() || 'Divers', donnees: donnees(), statut, source: c.source || 'saisie directe' });
    async function sauver(statut, puis) {
      const o = objet(statut);
      if (!o.titre) return toast('Il manque le titre.', true);
      if (!questions(o).length) return toast('Le contenu est vide ou incomplet.', true);
      try { const r = await api('enregistrerContenu', { contenu: o }); brouillon = null; await charger(); toast(statut === 'validé' ? 'Validé : Faël peut le faire.' : 'Enregistré, à valider.'); puis ? puis(r) : (location.hash = '#/p/contenu/' + r.id); }
      catch (e) { toast(e.message, true); }
    }
    page(tete(id ? 'Modifier' : 'Nouvel exercice', id ? '#/p/contenus' : '#/p/ajouter', c.statut ? el('span', { class: 'badge ' + (c.statut === 'validé' ? 'ok' : 'av'), text: c.statut }) : null),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('p', { class: 'muted petit', text: TYPES[ty] + ' · ' + (c.source || '') }),
        el('label', { class: 'champ' }, 'Titre', titre),
        el('div', { class: 'grille2' }, el('label', { class: 'champ' }, 'Matière', matiere), el('label', { class: 'champ' }, 'Thème', theme, dl)),
        corps,
        el('label', { class: 'champ' }, 'Je retiens (facultatif)', el('span', { class: 'aide-champ', text: 'Une carte par bloc : 1re ligne = titre, puis le texte, et « Ex : » pour un exemple.' }), retiens),
        c.texteLu ? el('details', { class: 'lu' }, el('summary', { text: 'Ce que Mistral a lu' }), el('pre', { text: c.texteLu })) : null),
      el('div', { class: 'rangee' },
        el('button', { class: 'btn', type: 'button', text: 'Essayer', onclick: () => sauver(c.statut === 'validé' ? 'validé' : 'à valider', r => { location.hash = '#/essai/' + r.id; }) }),
        el('button', { class: 'btn', type: 'button', text: 'Enregistrer', onclick: () => sauver(c.statut === 'validé' ? 'validé' : 'à valider') }),
        el('button', { class: 'btn ok', type: 'button', text: 'Valider pour Faël', onclick: () => sauver('validé') })),
      id ? el('button', { class: 'btn discret large', type: 'button', text: 'Archiver (Faël ne le verra plus)', onclick: async () => {
        if (!confirm('Archiver cet exercice ?')) return;
        try { await api('statutContenu', { id: c.id, statut: 'archivé' }); await charger(); location.hash = '#/p/contenus'; } catch (e) { toast(e.message, true); } } }) : null);
  }

  function ecranGenerer() {
    const ty = el('select', {}, Object.keys(TYPES).map(t => el('option', { value: t, text: TYPES[t], selected: t === 'qcm' })));
    const texte = el('textarea', { placeholder: 'Colle ou tape ici la leçon, la liste de mots, l\'exercice…' });
    const precision = el('input', { placeholder: 'Ex. : seulement les mots en bleu ; 10 questions faciles' });
    const photo = el('input', { type: 'file', accept: 'image/*', capture: 'environment' });
    const apercu = el('div', { class: 'vignettes' });
    let image = null;
    photo.addEventListener('change', async () => { const f = photo.files && photo.files[0]; if (!f) return; image = await reduire(f); apercu.replaceChildren(el('img', { src: image.apercu, alt: '', style: 'max-width:160px;border-radius:8px' })); });
    const go = el('button', { class: 'btn plein large', type: 'button', text: 'Préparer avec Mistral', disabled: !D.mistral, onclick: async () => {
      if (!texte.value.trim() && !image) return toast('Ajoute une photo ou un texte.', true);
      go.disabled = true; go.textContent = 'Mistral prépare le brouillon…';
      try {
        if (image) api('deposerPhoto', { base64: image.b64, commentaire: precision.value.trim() }).catch(() => {});
        const r = await api('genererContenu', { type: ty.value, texte: texte.value, precision: precision.value.trim(), photoBase64: image ? image.b64 : null });
        brouillon = { type: r.type, titre: r.titre, matiere: MATIERES.includes(r.matiere) ? r.matiere : 'Français', theme: r.theme, donnees: r.donnees, statut: 'à valider', source: 'Mistral (' + (image ? 'photo' : 'texte') + ')', texteLu: r.texteLu };
        location.hash = '#/p/nouveau/' + r.type;
      } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Préparer avec Mistral'; }
    } });
    page(tete('Photo ou texte', '#/p/ajouter'),
      D.mistral ? null : el('p', { class: 'aide', text: 'Mistral n\'est pas encore activé : ajoute la clé dans le moteur (voir la notice). En attendant, utilise la saisie directe.' }),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('label', { class: 'champ' }, 'Type d\'exercice voulu', ty),
        el('label', { class: 'champ' }, 'Photo de la leçon (facultatif)', photo), apercu,
        el('label', { class: 'champ' }, 'Ou le texte (facultatif)', texte),
        el('label', { class: 'champ' }, 'Précision pour Mistral (facultatif)', precision),
        el('p', { class: 'muted petit', text: 'Mistral reçoit seulement la leçon : jamais le prénom de Faël ni le journal. Le résultat arrive en brouillon, à relire et valider.' })),
      go);
  }
  function reduire(fichier) {
    return new Promise((ok, ko) => { const img = new Image(), url = URL.createObjectURL(fichier);
      img.onload = () => { const m = 2000, r = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok({ b64: c.toDataURL('image/jpeg', 0.85).split(',')[1], apercu: c.toDataURL('image/jpeg', 0.4) }); };
      img.onerror = () => ko(new Error('Image illisible.')); img.src = url; });
  }

  function ecranDevoirsParents() {
    const date = el('input', { type: 'date', value: jour() }), titre = el('input', { value: 'Mes devoirs du jour' });
    const etapes = el('div', { class: 'liste' });
    const ligne = (e = {}) => {
      const t = el('input', { value: e.texte || '', placeholder: 'Ex. : Apprendre les mots en bleu' }), m = el('input', { type: 'number', min: 1, max: 60, value: e.minutes || 10, 'aria-label': 'Minutes' });
      const s = el('select', { 'aria-label': 'Exercice lié' }, el('option', { value: '', text: 'Pas d\'exercice lié' }), contenus('validé').map(c => el('option', { value: c.id, text: c.titre, selected: String(c.id) === String(e.contenu) })));
      const b = el('div', { class: 'etape' }, t, m, s); b.lire = () => ({ texte: t.value.trim(), minutes: Number(m.value) || 10, contenu: s.value || '' }); return b;
    };
    const existant = (D.devoirs || []).find(d => d.date === jour());
    (existant ? existant.etapes : [{}, {}]).forEach(e => etapes.append(ligne(e)));
    if (existant) titre.value = existant.titre || titre.value;
    date.addEventListener('change', () => { const x = (D.devoirs || []).find(d => d.date === date.value); etapes.replaceChildren(...(x ? x.etapes : [{}, {}]).map(ligne)); });
    page(tete('Mes devoirs du jour', '#/parents'),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('div', { class: 'grille2' }, el('label', { class: 'champ' }, 'Date', date), el('label', { class: 'champ' }, 'Titre', titre)),
        el('p', { class: 'muted petit', text: 'Des étapes courtes (5 à 15 minutes), la plus facile en premier. Faël coche chaque étape et gagne 2 étoiles.' }),
        etapes, el('button', { class: 'btn discret', type: 'button', text: '+ Ajouter une étape', onclick: () => etapes.append(ligne()) })),
      el('button', { class: 'btn plein large', type: 'button', text: 'Enregistrer', onclick: async () => {
        const x = (D.devoirs || []).find(d => d.date === date.value);
        const ets = [...etapes.children].map(b => b.lire()).filter(e => e.texte);
        if (!ets.length) return toast('Ajoute au moins une étape.', true);
        try { await api('enregistrerDevoirs', { devoirs: { id: x && x.id, date: date.value, titre: titre.value.trim(), etapes: ets } }); await charger(); toast('Enregistré.'); location.hash = '#/parents'; } catch (e) { toast(e.message, true); }
      } }));
  }

  async function ecranEtoiles() {
    const nom = el('input', { placeholder: 'Ex. : 15 minutes de jeu' }), cout = el('input', { type: 'number', min: 1, value: 10 });
    const hist = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    page(tete('Étoiles et récompenses', '#/parents', badgeEtoiles()),
      el('h3', { text: 'Échanger' }),
      el('div', { class: 'liste' }, (D.recompenses || []).map(r => el('div', { class: 'tuile' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '🎁' }),
        el('span', {}, el('span', { class: 't', text: r.nom }), el('span', { class: 's', text: r.cout + ' étoiles' })),
        el('button', { class: 'btn', style: 'margin-left:auto;min-height:46px', type: 'button', text: 'Échanger', disabled: (D.etoiles || 0) < Number(r.cout), onclick: async () => {
          if (!confirm('Échanger ' + r.cout + ' étoiles contre « ' + r.nom + ' » ?')) return;
          try { const x = await api('echangerRecompense', { id: r.id }); D.etoiles = x.etoiles; store.set('donnees', D); toast('Échangé !'); ecranEtoiles(); } catch (e) { toast(e.message, true); } } })))),
      el('h3', { text: 'Ajouter une récompense' }),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' }, el('div', { class: 'grille2' }, el('label', { class: 'champ' }, 'Récompense', nom), el('label', { class: 'champ' }, 'Coût en étoiles', cout)),
        el('button', { class: 'btn', type: 'button', text: 'Ajouter', onclick: async () => { try { await api('enregistrerRecompense', { recompense: { nom: nom.value.trim(), cout: Number(cout.value) } }); await charger(); ecranEtoiles(); } catch (e) { toast(e.message, true); } } })),
      el('h3', { text: 'Ajuster à la main' }),
      el('div', { class: 'rangee' }, [-5, -1, 1, 5].map(n => el('button', { class: 'btn discret', type: 'button', text: (n > 0 ? '+' : '') + n, onclick: async () => { try { const x = await api('ajusterEtoiles', { delta: n, motif: 'ajustement parent' }); D.etoiles = x.etoiles; store.set('donnees', D); ecranEtoiles(); } catch (e) { toast(e.message, true); } } }))),
      el('h3', { text: 'Historique' }), hist);
    try { const h = await api('historiqueEtoiles'); hist.replaceChildren(...(h.length ? h.slice(0, 30).map(x => el('p', { class: 'petit' }, el('b', { text: (Number(x.delta) > 0 ? '+' : '') + x.delta + ' ' }), x.motif, el('span', { class: 'muted', text: ' · ' + String(x.horodatage).slice(0, 16) }))) : [el('p', { class: 'vide', text: 'Rien pour l\'instant.' })])); }
    catch (e) { hist.replaceChildren(el('p', { class: 'muted petit', text: 'Historique indisponible hors ligne.' })); }
  }

  async function ecranJournal() {
    const sel = (lib, opts) => { const s = el('select', {}, el('option', { value: '', text: '—' }), opts.map(o => el('option', { value: o, text: o }))); return [el('label', { class: 'champ' }, lib, s), s]; };
    const [lD, sD] = sel('Devoirs', ['faciles', 'moyens', 'difficiles']), [lS, sS] = sel('Sommeil', ['bon', 'moyen', 'mauvais']), [lH, sH] = sel('Humeur', ['bonne', 'moyenne', 'difficile']);
    const rem = el('textarea', { style: 'min-height:90px', placeholder: 'Ce qui a marché, ce qui a coincé…' }), date = el('input', { type: 'date', value: jour() });
    const liste = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    let obs = [];
    page(tete('Journal d\'observation', '#/parents'),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' },
        el('label', { class: 'champ' }, 'Date', date), el('div', { class: 'grille2' }, lD, lS), lH, el('label', { class: 'champ' }, 'Remarque', rem),
        el('button', { class: 'btn plein', type: 'button', text: 'Noter', onclick: async () => { try { await api('ajouterObservation', { observation: { date: date.value, devoirs: sD.value, sommeil: sS.value, humeur: sH.value, remarque: rem.value.trim() } }); toast('Noté.'); ecranJournal(); } catch (e) { toast(e.message, true); } } })),
      el('button', { class: 'btn discret large', type: 'button', text: 'Copier le journal', onclick: async () => {
        const t = obs.map(o => [o.date, 'devoirs ' + (o.devoirs || '—'), 'sommeil ' + (o.sommeil || '—'), 'humeur ' + (o.humeur || '—'), o.remarque].filter(Boolean).join(' · ')).join('\n');
        try { await navigator.clipboard.writeText(t); toast('Copié.'); } catch (e) { toast('Copie impossible sur cet appareil.', true); } } }),
      el('h3', { text: 'Dernières notes' }), liste);
    try { obs = await api('observations'); liste.replaceChildren(...(obs.length ? obs.map(o => el('div', { class: 'tuile', style: 'flex-direction:column;align-items:flex-start' }, el('b', { text: o.date }), el('span', { class: 's', text: ['devoirs ' + (o.devoirs || '—'), 'sommeil ' + (o.sommeil || '—'), 'humeur ' + (o.humeur || '—')].join(' · ') }), o.remarque ? el('span', { text: o.remarque }) : null)) : [el('p', { class: 'vide', text: 'Pas encore de note.' })])); }
    catch (e) { liste.replaceChildren(el('p', { class: 'muted petit', text: 'Indisponible hors ligne.' })); }
  }

  async function ecranConseils() {
    const zone = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    page(tete('Conseils', '#/parents'), zone);
    try { const c = await api('conseils'); zone.replaceChildren(...c.sections.map(s => el('section', { class: 'carte' }, el('h2', { text: s.titre }), el('ul', {}, s.points.map(p => el('li', { text: p })))))); }
    catch (e) { zone.replaceChildren(el('p', { class: 'vide', text: 'Conseils indisponibles hors ligne.' })); }
  }

  function ecranReglages() {
    const r = R();
    const sel = (lib, vals, v, fmt) => { const s = el('select', {}, vals.map(x => el('option', { value: x, text: fmt ? fmt(x) : x, selected: String(x) === String(v) }))); return [el('label', { class: 'champ' }, lib, s), s]; };
    const [lT, sT] = sel('Questions par série', [3, 5, 8, 10], r.taille), [lS, sS] = sel('Nombre de séries', [1, 2, 3], r.series);
    const [lP, sP] = sel('Pause qui bouge entre les séries', ['oui', 'non'], r.pauses ? 'oui' : 'non'), [lD, sD] = sel('Durée de la pause', [30, 45, 60], r.dureePause, x => x + ' secondes');
    const [lV, sV] = sel('Lecture à voix haute', ['oui', 'non'], r.voix ? 'oui' : 'non'), [lC, sC] = sel('Mode calme (moins de décor)', ['oui', 'non'], r.calme ? 'oui' : 'non');
    const code = el('input', { type: 'password', inputmode: 'numeric', value: r.codeParents || '', placeholder: 'Aucun', autocomplete: 'off' });
    page(tete('Réglages', '#/parents'),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('h2', { text: 'Mode concentration' }), el('div', { class: 'grille2' }, lT, lS), el('div', { class: 'grille2' }, lP, lD), el('div', { class: 'grille2' }, lV, lC),
        el('label', { class: 'champ' }, 'Code parents', el('span', { class: 'aide-champ', text: 'Pour que Faël n\'entre pas dans l\'espace parents. Vide = pas de code.' }), code)),
      el('button', { class: 'btn plein large', type: 'button', text: 'Enregistrer', onclick: async () => {
        try { D.reglages = await api('enregistrerReglages', { reglages: { taille: Number(sT.value), series: Number(sS.value), pauses: sP.value === 'oui', dureePause: Number(sD.value), voix: sV.value === 'oui', calme: sC.value === 'oui', codeParents: code.value.trim() } }); store.set('donnees', D); toast('Enregistré.'); location.hash = '#/parents'; }
        catch (e) { toast(e.message, true); } } }));
  }

  /* ---------- Routage ---------- */
  async function router() {
    const h = location.hash.replace(/^#\/?/, ''), [a, b, c] = h.split('/');
    if (a === 'relier' || !store.get('cfg', null)) return ecranRelier();
    if (!D) { app().replaceChildren(el('p', { class: 'vide', text: 'Chargement…' })); try { await charger(); } catch (e) { toast(e.message, true); return ecranRelier(); } }
    if (!a) return ecranAccueil();
    if (a === 'seance') return ecranSeance(b, false);
    if (a === 'devoirs') return ecranDevoirs(b);
    if (a === 'parents') return porteParents(ecranParents);
    if (a === 'essai') return porteParents(() => ecranSeance(b, true));
    if (a === 'p') return porteParents(() => {
      if (b === 'contenus') return ecranContenus();
      if (b === 'ajouter') return ecranAjouter();
      if (b === 'nouveau') return TYPES[c] ? ecranEditeur(null, c) : ecranAjouter();
      if (b === 'contenu') return ecranEditeur(c);
      if (b === 'generer') return ecranGenerer();
      if (b === 'devoirs') return ecranDevoirsParents();
      if (b === 'etoiles') return ecranEtoiles();
      if (b === 'journal') return ecranJournal();
      if (b === 'conseils') return ecranConseils();
      if (b === 'reglages') return ecranReglages();
      return ecranParents();
    });
    ecranAccueil();
  }
  window.addEventListener('hashchange', router);
  window.addEventListener('online', () => viderFile());
  document.addEventListener('DOMContentLoaded', async () => {
    router();
    if (store.get('cfg', null) && D) charger().then(ok => { if (ok && !location.hash.replace(/^#\/?/, '')) ecranAccueil(); }).catch(() => {});
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  /* Exposé pour les tests uniquement */
  window.__cf = { questions, variantes, depuisTexte, versTexte };
})();
