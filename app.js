/* Cahiers de Faël — appli unique (LABO, version 5, 08/11/2026 : accueil à barre unique, semaine, « J'ai fini ! » et étoiles validées, carnet de bord, cadenas parent dans les séances).
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
      try { const r = await api('envoyerResultats', file[0]); if (D && r) { D.etoiles = r.etoiles; if (r.attente != null) D.attente = r.attente; store.set('donnees', D); } }
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
  function variantes(mot, nb = 2) {
    const morceaux = mot.split(' '), w = morceaux.pop(), avant = morceaux.length ? morceaux.join(' ') + ' ' : '';
    const c = new Set();
    FAUTES.forEach(([re, f]) => { const v = w.replace(re, f); if (v !== w && v.length > 1) c.add(v); });
    return melange([...c]).slice(0, nb).map(v => avant + v);
  }
  /* Coup de pouce de conjugaison : la règle, jamais la terminaison exacte de la réponse */
  function regleConj(p, temps) {
    const t = norm(temps || 'present'), g = ['je', 'tu'].includes(p) ? 1 : ['il', 'elle', 'on'].includes(p) ? 2 : p === 'nous' ? 3 : p === 'vous' ? 4 : 5;
    if (/imparfait/.test(t)) return 'Pense à la règle : à l\'imparfait, on entend « ais », « ait », « ions », « iez » ou « aient » à la fin. Laquelle va avec « ' + p + ' » ?';
    if (/futur/.test(t)) return 'Pense à la règle : au futur, on entend souvent le verbe à l\'infinitif, puis la fin qui change avec la personne. Dis la phrase tout bas.';
    return ['', 'Pense à la règle : avec je et tu, le verbe finit souvent par -s (ou -x).', 'Pense à la règle : avec il, elle ou on, il n\'y a jamais de -s à la fin du verbe.',
      'Pense à la règle : avec nous, le verbe finit presque toujours de la même façon. Tu t\'en souviens ?', 'Pense à la règle : avec vous, le verbe finit presque toujours de la même façon. Tu t\'en souviens ?',
      'Pense à la règle : avec ils et elles, le verbe finit par des lettres qu\'on n\'entend pas.'][g];
  }
  function questions(c) {
    const d = c.donnees || {}, out = [];
    if (c.type === 'mots') {
      /* Aucune écriture au clavier : seulement des choix (l'écriture se fait sur papier) */
      const liste = (d.mots || []).map(m => ({ mot: String(m.mot || '').trim(), phrase: m.phrase })).filter(m => m.mot)
        .map(m => Object.assign(m, { nom: m.mot.replace(/^(un|une|des|le|la|les)\s+|^l'/i, '') }));
      liste.forEach(m => {
        const { mot, nom } = m, n = nom.length, autres = melange(liste.filter(x => x !== m)).slice(0, 2).map(x => x.nom);
        const fautes = variantes(mot);
        if (fautes.length) out.push({ cle: 'c:' + mot, mode: 'choix', diff: n - 3,
          consigne: 'Choisis le mot **bien écrit**.', enonce: 'Quel mot est bien écrit ?', dire: [{ texte: mot }],
          choix: melange([mot, ...fautes]), bonne: mot,
          aide: 'Écoute le mot, puis regarde chaque lettre, surtout la fin.', explication: 'On écrit : ' + mot + '.' });
        const dansPhrase = m.phrase && norm(m.phrase).includes(norm(nom));
        if (autres.length === 2 && (dansPhrase || !fautes.length)) out.push(dansPhrase
          ? { cle: 'p:' + mot, mode: 'choix', diff: n,
            consigne: 'Choisis le mot **qui manque**.', enonce: m.phrase.replace(new RegExp(nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '____'),
            dire: [{ texte: m.phrase }], choix: melange([nom, ...autres]), bonne: nom,
            aide: 'Relis la phrase en entier : quel mot a du sens ?', explication: m.phrase }
          : { cle: 'o:' + mot, mode: 'choix', diff: n,
            consigne: '**Écoute** et choisis le mot que tu entends.', enonce: 'Quel mot entends-tu ?', dire: [{ texte: mot }],
            choix: melange([nom, ...autres]), bonne: nom,
            aide: 'Réécoute le mot et regarde la première lettre.', explication: 'C\'était : ' + mot + '.' });
        /* Remettre la phrase dans l'ordre (étiquettes à toucher, aucun clavier) */
        const morceauxPhrase = String(m.phrase || '').replace(/[.!?…]+\s*$/, '').split(/\s+/).filter(Boolean);
        if (morceauxPhrase.length >= 3 && morceauxPhrase.length <= 9) out.push({ cle: 'r:' + mot, mode: 'ordre', diff: n + 2,
          consigne: 'Touche les étiquettes **dans l\'ordre** pour faire la phrase.', enonce: '', dire: [],
          etiquettes: melange(morceauxPhrase), bonne: morceauxPhrase.join(' '),
          aide: 'Cherche d\'abord le mot qui commence par une majuscule : c\'est le début de la phrase.', explication: m.phrase });
      });
    } else if (c.type === 'conjugaison') {
      const f = d.formes || {}, verbe = d.verbe || 'le verbe', temps = d.temps || 'présent';
      const valeurs = [...new Set(Object.values(f).filter(Boolean))];
      PRONOMS.filter(p => f[p]).forEach(p => {
        const forme = f[p], diff = ['nous', 'vous'].includes(p) ? 2 : ['ils', 'elles'].includes(p) ? 3 : 1;
        const autres = melange(valeurs.filter(v => v !== forme)).slice(0, 3);
        out.push({ cle: 'c:' + p, mode: 'choix', diff,
          consigne: 'Choisis la bonne forme du verbe **' + verbe + '** au ' + temps + '.', enonce: pron(p, forme) + '____', dire: [{ texte: p }],
          choix: melange([forme, ...autres]), bonne: forme,
          aide: regleConj(p, temps), explication: pron(p, forme) + forme + '.' });
        const lib = x => pron(x, forme).trim(), faux = melange(PRONOMS.filter(x => f[x] && f[x] !== forme)).slice(0, 2);
        if (faux.length === 2) out.push({ cle: 'p:' + p, mode: 'choix', diff: diff + 1,
          consigne: 'Choisis **qui** fait l\'action.', enonce: '____ ' + forme, dire: [{ texte: forme }],
          choix: melange([lib(p), ...faux.map(lib)]), bonne: lib(p),
          aide: 'Regarde bien la fin du verbe, puis pense à la règle : qui peut aller avec cette fin ?', explication: pron(p, forme) + forme + '.' });
      });
    } else if (c.type === 'vocabulaire') {
      const paires = (d.paires || []).filter(p => p.fr && p.en), lang = /anglais/i.test(d.langue || 'anglais') ? 'en-GB' : 'fr-FR';
      paires.forEach((p, i) => {
        const autresEn = melange(paires.filter(x => x !== p)).slice(0, 2).map(x => x.en), autresFr = melange(paires.filter(x => x !== p)).slice(0, 2).map(x => x.fr);
        out.push({ cle: 'fe:' + p.fr, mode: 'choix', diff: i % 3,
          consigne: 'Comment dit-on en **anglais** ?', enonce: p.fr, dire: [{ texte: p.fr }],
          choix: melange([p.en, ...autresEn]), bonne: p.en, direChoix: lang,
          aide: 'Dis chaque mot anglais tout bas : lequel as-tu appris pour cet objet ?', explication: p.fr + ' se dit « ' + p.en + ' ».' });
        out.push({ cle: 'ef:' + p.en, mode: 'choix', diff: 1 + i % 3,
          consigne: '**Écoute** et choisis le mot en **français**.', enonce: p.en, dire: [{ texte: p.en, lang }],
          choix: melange([p.fr, ...autresFr]), bonne: p.fr,
          aide: 'Réécoute le mot doucement et pense à la leçon : quand l\'as-tu entendu ?', explication: '« ' + p.en + ' » veut dire ' + p.fr + '.' });
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
  const estJuste = (q, rep) => rep === q.bonne;

  /* Défi de fin de séance : 2 ou 3 questions bien plus difficiles, sans aide, +2 étoiles chacune */
  function defis(c) {
    const d = c.donnees || {}, out = [];
    if (c.type === 'qcm') {
      (d.defis && d.defis.length ? d.defis : (d.questions || []).slice(-3)).forEach((q, i) => {
        const choix = (q.choix || []).filter(Boolean); if (choix.length < 2) return;
        const bonne = choix[Math.min(Number(q.bonne) || 0, choix.length - 1)];
        out.push({ cle: 'd:' + i, mode: 'choix', consigne: q.consigne || 'Choisis la bonne réponse.', enonce: q.question || '', dire: [{ texte: q.question }], choix: melange(choix), bonne, explication: q.explication || ('La bonne réponse est : ' + bonne + '.') });
      });
    } else if (c.type === 'mots') {
      /* « Un seul mot est mal écrit » : il faut vérifier chaque mot, pas seulement en reconnaître un */
      const mots = (d.mots || []).map(m => String(m.mot || '').trim()).filter(Boolean);
      if (mots.length >= 4) melange(mots.map(mot => ({ mot, f: variantes(mot, 1) })).filter(x => x.f.length)).slice(0, 3).forEach(x => {
        const autres = melange(mots.filter(m => m !== x.mot)).slice(0, 3);
        out.push({ cle: 'd:' + x.mot, mode: 'choix', consigne: 'Attention : **un seul** de ces mots est **mal écrit**. Lequel ?', enonce: 'Trouve le mot mal écrit.', dire: [],
          choix: melange([x.f[0], ...autres]), bonne: x.f[0], explication: 'Il fallait écrire : ' + x.mot + '.' });
      });
    } else if (c.type === 'conjugaison') {
      const f = d.formes || {}, valeurs = [...new Set(Object.values(f).filter(Boolean))];
      melange(PRONOMS.filter(p => f[p] && !['il', 'elle', 'on', 'je'].includes(p))).slice(0, 3).forEach(p => out.push({ cle: 'd:' + p, mode: 'choix',
        consigne: 'Toutes les formes sont là : choisis la bonne pour **' + p + '** au ' + (d.temps || 'présent') + '.', enonce: pron(p, f[p]) + '____', dire: [{ texte: p }],
        choix: melange(valeurs.slice(0, 6).includes(f[p]) ? valeurs.slice(0, 6) : [f[p], ...valeurs.filter(v => v !== f[p]).slice(0, 5)]), bonne: f[p], explication: pron(p, f[p]) + f[p] + '.' }));
    } else if (c.type === 'vocabulaire') {
      const paires = (d.paires || []).filter(p => p.fr && p.en), lang = /anglais/i.test(d.langue || 'anglais') ? 'en-GB' : 'fr-FR';
      melange(paires).slice(0, 3).forEach(p => out.push({ cle: 'd:' + p.en, mode: 'choix', consigne: '**Écoute bien** : le mot n\'est pas écrit. Choisis ce qu\'il veut dire.', enonce: '🔊 Écoute le mot', dire: [{ texte: p.en, lang }],
        choix: melange([p.fr, ...melange(paires.filter(x => x !== p)).slice(0, 4).map(x => x.fr)]), bonne: p.fr, explication: '« ' + p.en + ' » veut dire ' + p.fr + '.' }));
    }
    return out.length >= 2 ? out.slice(0, 3).map(q => Object.assign(q, { defi: true, diff: 9 })) : [];
  }

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
  /* Icônes dessinées (design D) */
  const ICO = {
    son: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    ampoule: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bulle: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>'
  };
  const outil = (ico, lib, cls, onclick) => el('button', { class: 'btn outil ' + (cls || ''), type: 'button', onclick }, el('span', { class: 'ico', html: ICO[ico] }), el('span', { class: 'lib-outil', text: lib }));
  const app = () => $('#app');
  function page(...k) { app().replaceChildren(el('div', { class: 'wrap' }, ...k)); window.scrollTo(0, 0); document.body.classList.toggle('calme', !!R().calme); document.body.classList.remove('avec-onglets'); }
  function tete(titre, retour, droite) {
    return el('header', { class: 'tete' }, el('div', { class: 'gauche' }, retour ? el('a', { class: 'rond', href: retour, 'aria-label': 'Retour', text: '‹' }) : null, el('h1', { text: titre })), droite || null);
  }
  const badgeEtoiles = () => el('span', { class: 'etoiles', 'aria-label': (D ? D.etoiles || 0 : 0) + ' étoiles' + (D && D.attente ? ', ' + D.attente + ' à valider' : '') }, el('b', { text: '★' }), String(D ? D.etoiles || 0 : 0), D && D.attente ? el('small', { class: 'attente', text: '+' + D.attente }) : null);
  const ICONES = { mots: '✏️', conjugaison: '🔤', vocabulaire: '🇬🇧', qcm: '✅' };
  const TYPES = { mots: 'Mots de dictée', conjugaison: 'Conjugaison', vocabulaire: 'Vocabulaire', qcm: 'Questions' };
  const MATIERES = ['Français', 'Mathématiques', 'Anglais', 'Questionner le monde'];
  const contenus = statut => (D ? D.contenus : []).filter(c => !statut || c.statut === statut);
  const contenu = id => (D ? D.contenus : []).find(c => String(c.id) === String(id));

  /* ---------- Premier lancement : relier au moteur ---------- */
  function ecranRelier() {
    const cfg = store.get('cfg', {}) || {};
    const url = el('input', { type: 'url', value: cfg.url || '', placeholder: 'https://script.google.com/macros/s/…/exec' });
    const jet = el('input', { type: 'password', value: cfg.jeton || '', autocomplete: 'off', placeholder: 'Code d\'accès' });
    const go = el('button', { class: 'btn plein large', type: 'button', text: 'Relier l\'appli', onclick: async () => {
      const u = url.value.trim(), j = jet.value.trim();
      if (!u) return toast('Colle d\'abord l\'adresse du moteur (elle finit par /exec).', true);
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) return toast('Cette adresse ne ressemble pas à celle du moteur : elle doit commencer par https://script.google.com/ et finir par /exec.', true);
      if (!j) return toast('Colle le code d\'accès (la valeur JETON).', true);
      store.set('cfg', { url: u, jeton: j });
      go.disabled = true; go.textContent = 'Vérification…';
      try { await charger(); toast('Appli reliée.'); location.hash = '#/'; }
      catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Relier l\'appli'; }
    } });
    page(tete('Relier l\'appli', D ? '#/p/reglages' : null),
      el('section', { class: 'carte' }, el('p', { text: 'À faire une seule fois sur chaque appareil. Ces informations restent sur cet appareil.' }),
        el('label', { class: 'champ' }, 'Adresse du moteur', el('span', { class: 'aide-champ', text: 'L\'adresse de l\'application Web « Moteur LABO », qui finit par /exec.' }), url),
        el('label', { class: 'champ', style: 'margin-top:12px' }, 'Code d\'accès', el('span', { class: 'aide-champ', text: 'Affiché dans le journal d\'exécution de setup().' }), jet),
        el('div', { style: 'margin-top:16px' }, go)));
  }

  /* ---------- Dates ---------- */
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dateJ = j => new Date(j + 'T12:00:00');
  const decale = (j, n) => { const d = dateJ(j); d.setDate(d.getDate() + n); return jour(d); };
  const nomJour = j => { const d = dateJ(j); return JOURS[d.getDay()] + ' ' + d.getDate(); };
  const lundiDe = j => decale(j, -((dateJ(j).getDay() + 6) % 7));
  /* Le week-end, on prépare la semaine qui vient */
  const lundiCourant = () => { const n = new Date().getDay(); return lundiDe(n === 0 || n === 6 ? plusJours(2) : jour()); };
  /* Le prochain jour d'école (pas le mercredi ni le week-end) : ce que Faël prépare ce soir */
  function prochainJourEcole() { let j = jour(); do { j = decale(j, 1); } while ([0, 3, 6].includes(dateJ(j).getDay())); return j; }

  /* ---------- Espace de Faël ---------- */
  let filtre = { q: '', matiere: '' };
  let prepa = null; /* ce que la barre de recherche transmet à un écran parent (texte, tâche…) */
  function ecranAccueil() {
    const valides = contenus();
    const q = el('input', { type: 'search', placeholder: parentOk ? 'Chercher un exercice, ou taper un texte…' : 'Chercher : dictée, conjugaison, anglais…', 'aria-label': 'Chercher', value: filtre.q, autocomplete: 'off', enterkeyhint: 'search' });
    const x = el('button', { class: 'x', type: 'button', 'aria-label': 'Effacer', text: '✕', hidden: !filtre.q });
    const liste = el('div', { class: 'liste' }), chips = el('div', { class: 'chips' }), actions = el('div');
    const mats = MATIERES.filter(m => valides.some(c => c.matiere === m)).concat([...new Set(valides.map(c => c.matiere))].filter(m => !MATIERES.includes(m)));
    const tuile = (c, mots) => {
      const a = el('a', { class: 'tuile', href: '#/seance/' + c.id },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: ICONES[c.type] || '📘' }),
        el('span', {}, el('span', { class: 't' }, surligne(c.titre, mots)), el('span', { class: 's', text: TYPES[c.type] || '' })),
        el('span', { class: 'fl', text: '›' }));
      return parentOk ? el('div', { class: 'ligne-tuile' }, a, el('a', { class: 'rond', href: '#/p/contenu/' + c.id, 'aria-label': 'Modifier ' + c.titre, text: '✎' })) : a;
    };
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
          dans.filter(c => c.theme === t).forEach(c => blocs.push(tuile(c, mots)));
        });
      });
      liste.replaceChildren(...(blocs.length ? blocs : [el('p', { class: 'vide', text: valides.length ? 'Rien trouvé. Essaie un autre mot.' : 'Pas encore d\'exercice.' })]));
      /* Mode parent : le texte tapé peut devenir un exercice, une tâche ou une demande */
      const t = filtre.q.trim();
      actions.replaceChildren(...(parentOk && t ? [el('div', { class: 'actions-recherche' },
        el('p', { class: 'muted petit', text: 'Avec « ' + (t.length > 40 ? t.slice(0, 40) + '…' : t) + ' » :' }),
        el('button', { class: 'btn', type: 'button', text: '✨ Créer un exercice avec ce texte', onclick: () => { prepa = { texte: t }; location.hash = '#/p/generer'; } }),
        el('button', { class: 'btn', type: 'button', text: '📅 Ajouter à la semaine', onclick: () => { prepa = { titre: t }; location.hash = '#/p/semaine'; } }),
        el('button', { class: 'btn', type: 'button', text: '💬 Envoyer comme demande à l\'IA', onclick: () => { prepa = { demande: t }; location.hash = '#/p/exercices'; } }))] : []));
    }
    q.addEventListener('input', () => { filtre.q = q.value; x.hidden = !q.value; dessiner(); });
    x.onclick = () => { q.value = ''; filtre.q = ''; x.hidden = true; dessiner(); q.focus(); };

    /* Devoirs à préparer ce soir, tirés de la semaine préparée par les parents */
    const pj = prochainJourEcole(), taches = (D.taches || []).filter(t => t.jour === pj);
    const blocDevoirs = taches.length ? el('section', { class: 'carte devoirs' },
      el('h2', { text: 'Mes devoirs pour ' + nomJour(pj) }),
      el('p', { class: 'muted petit', text: 'Ce que la maîtresse a donné. Je touche une ligne pour commencer, et je coche quand c\'est fait.' }),
      el('div', { class: 'liste' }, taches.map(t => el('a', { class: 'case' + (t.statut === 'fait' ? ' fait' : ''), href: '#/tache/' + t.id },
        el('span', { class: 'coche', text: t.statut === 'fait' ? '✓' : '' }),
        el('span', {}, el('span', { class: 't', text: t.titre }), t.matiere ? el('span', { class: 's muted petit', style: 'display:block', text: t.matiere + (t.contenu ? ' · exercice dans l\'appli' : '') }) : null)))))
      : parentOk ? el('p', { class: 'aide petit', text: 'Rien de prévu pour ' + nomJour(pj) + '. Les devoirs se préparent dans l\'onglet Semaine.' }) : null;

    page(tete('Mes cahiers', null, badgeEtoiles()),
      parentOk ? el('div', { class: 'mode-parent' }, el('span', { text: '🔓 Mode parent' }), el('button', { class: 'btn discret', type: 'button', text: 'Verrouiller', onclick: () => { parentOk = false; ecranAccueil(); } })) : null,
      carteTirelire(),
      blocDevoirs,
      el('div', { class: 'recherche', role: 'search' }, el('span', { class: 'loupe', 'aria-hidden': 'true', text: '🔍' }), q, x),
      actions, chips, liste,
      el('a', { class: 'btn ok large', href: '#/fini', text: '🎉 J\'ai fini !' }),
      el('a', { class: 'tuile parents', href: '#/parents' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: parentOk ? '🔓' : '🔒' }),
        el('span', {}, el('span', { class: 't', text: 'Espace parents' }), el('span', { class: 's', text: 'Semaine · Exercices · Carnet de bord · Conseils · Réglages' })), el('span', { class: 'fl', text: '›' })));
    dessiner();
  }

  /* Une tâche de devoirs, côté Faël : minuteur, exercice lié, je coche */
  function ecranTache(id) {
    const t = (D.taches || []).find(x => String(x.id) === String(id));
    if (!t) { page(tete('Mes devoirs', '#/'), el('p', { class: 'vide', text: 'Introuvable.' })); return; }
    const total = 10 * 60, C = 2 * Math.PI * 62, svg = anneau(C), arc = svg.querySelector('.reste'), txt = svg.querySelector('text');
    let reste = total, minuteur = null;
    const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    txt.textContent = fmt(reste);
    const lancer = el('button', { class: 'btn', type: 'button', text: 'Je lance 10 minutes', onclick: () => {
      if (minuteur) return; lancer.disabled = true;
      minuteur = setInterval(() => { reste--; txt.textContent = fmt(Math.max(0, reste)); arc.setAttribute('stroke-dashoffset', C * (1 - reste / total)); if (reste <= 0) { clearInterval(minuteur); dire([{ texte: 'Les 10 minutes sont finies. Tu peux faire une pause.' }]); } }, 1000);
    } });
    const fini = el('button', { class: 'btn ok large', type: 'button', text: t.statut === 'fait' ? 'Déjà fait ✓' : 'C\'est fait, je coche', disabled: t.statut === 'fait', onclick: async () => {
      clearInterval(minuteur); fini.disabled = true;
      t.statut = 'fait'; store.set('donnees', D);
      envoyer({ resultats: [], etoiles: 2, motif: 'Devoirs : ' + t.titre });
      D.attente = (D.attente || 0) + 2; store.set('donnees', D);
      api('enregistrerTache', { tache: Object.assign({}, t, { statut: 'fait', source: 'coché par Faël' }) }).catch(() => {});
      ecranFinTache(t);
    } });
    page(tete(t.titre, '#/', badgeEtoiles()), el('section', { class: 'carte pause' },
      el('p', { class: 'muted petit', text: (t.matiere ? t.matiere + ' · ' : '') + 'pour ' + nomJour(t.jour) }),
      t.details ? el('p', { class: 'enonce', text: t.details }) : null,
      svg, el('div', { class: 'rangee', style: 'width:100%' }, lancer,
        t.contenu && contenu(t.contenu) ? el('a', { class: 'btn plein', href: '#/seance/' + t.contenu, text: 'Ouvrir l\'exercice' }) : null), fini));
    dire([{ texte: t.titre + '. ' + (t.details || '') }]);
  }

  /* Après un devoir coché : mêmes choix qu'en fin d'exercice */
  function ecranFinTache(t) {
    page(tete('Bravo !', '#/', badgeEtoiles()), el('section', { class: 'carte bilan' },
      el('span', { class: 'grand', 'aria-hidden': 'true', text: '✅' }), el('h2', { text: 'Devoir fait !' }), el('p', { text: t.titre }),
      el('span', { class: 'gros', text: '+2 ★' }), el('p', { class: 'muted petit', text: 'Tes étoiles attendent que papa ou maman les valide.' }),
      el('a', { class: 'btn ok large', href: '#/fini', text: '🎉 J\'ai fini !' }),
      el('a', { class: 'btn large', href: '#/', text: 'J\'ai encore des devoirs à faire ici' })));
    dire([{ texte: 'Bravo, devoir fait ! Deux étoiles de plus.' }]);
  }

  /* « J'ai fini ! » : Faël voit ses étoiles tout de suite, un parent les valide ensuite */
  function ecranFini() {
    const n = D.attente || 0;
    page(tete('J\'ai fini !', '#/', badgeEtoiles()), el('section', { class: 'carte bilan' },
      el('span', { class: 'grand', 'aria-hidden': 'true', text: n ? '🌟' : '🙂' }),
      n ? el('h2', { text: 'Bravo, tu as gagné ' + n + ' étoile' + (n > 1 ? 's' : '') + ' !' }) : el('h2', { text: 'Pas encore d\'étoile à valider.' }),
      el('p', { text: n ? 'Montre ton écran à papa ou maman : ils valident tes étoiles et elles vont dans ta tirelire.' : 'Fais un exercice ou coche un devoir pour gagner des étoiles.' }),
      n ? el('a', { class: 'btn plein large', href: '#/p/valider', text: 'Papa ou maman valide' }) : el('a', { class: 'btn plein large', href: '#/', text: 'Retour à mes cahiers' })));
    if (n) dire([{ texte: 'Bravo, tu as gagné ' + n + ' étoiles. Montre ton écran à papa ou maman.' }]);
  }

  /* ---------- Espace parents ---------- */
  let parentOk = false;
  function porteParents(suite) {
    const code = String(R().codeParents || '');
    if (!code || parentOk) { parentOk = true; return suite(); }
    const inp = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Code parents' });
    const go = () => { if (inp.value === code) { parentOk = true; suite(); } else { toast('Code incorrect.', true); inp.value = ''; } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    page(tete('Espace parents', '#/'), el('section', { class: 'carte' }, el('label', { class: 'champ' }, 'Code parents', inp),
      el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn plein large', type: 'button', text: 'Entrer', onclick: go }))));
    setTimeout(() => inp.focus(), 60);
  }
  /* Fenêtre par-dessus l'écran en cours (la séance de Faël continue derrière) */
  function voile(titre, ...k) {
    const corps = el('div', { class: 'corps' }, ...k);
    const v = el('div', { class: 'voile', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre },
      el('div', { class: 'feuille' }, el('header', { class: 'tete' }, el('h1', { text: titre }), el('button', { class: 'rond', type: 'button', 'aria-label': 'Fermer', text: '✕', onclick: () => v.remove() })), corps));
    v.corps = corps; document.body.append(v); return v;
  }
  function codeDansVoile(v, suite) {
    const code = String(R().codeParents || '');
    if (!code || parentOk) { parentOk = true; return suite(); }
    const inp = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Code parents' });
    const go = () => { if (inp.value === code) { parentOk = true; suite(); } else { toast('Code incorrect.', true); inp.value = ''; } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    v.corps.replaceChildren(el('label', { class: 'champ' }, 'Code parents', inp), el('button', { class: 'btn plein large', type: 'button', text: 'Entrer', onclick: go }));
    setTimeout(() => inp.focus(), 60);
  }

  const ONGLETS_P = [['semaine', '📅', 'Semaine'], ['exercices', '✏️', 'Exercices'], ['etoiles', '⭐', 'Étoiles'], ['carnet', '📓', 'Carnet'], ['conseils', '💬', 'Conseils'], ['reglages', '⚙️', 'Réglages']];
  function navParents(actif) {
    return el('nav', { class: 'onglets', 'aria-label': 'Espace parents' }, ONGLETS_P.map(([k, ic, lib]) => el('a', { href: '#/p/' + k, 'aria-current': k === actif ? 'page' : null },
      el('span', { 'aria-hidden': 'true', text: ic }), el('small', { text: lib }), k === 'etoiles' && D && (D.attente || (D.choix || []).length) ? el('i', { class: 'pastille', 'aria-label': 'étoiles à valider' }) : null)));
  }
  const moteurAJour = () => !!(D && Array.isArray(D.taches));

  /* ---------- Aide côté parents : « ? » par section, aide générale, visite guidée ---------- */
  const AIDE = {
    accueil: { titre: 'L\'accueil de Faël', icone: '🏠',
      quoi: 'L\'écran que Faël voit en ouvrant l\'appli. Tout y est pensé pour qu\'il sache quoi faire sans aide.',
      comment: ['En haut, sa tirelire : ses étoiles, celles qui attendent votre validation, et la prochaine récompense avec une jauge.',
        '« Mes devoirs pour… » : les devoirs du prochain jour d\'école, tirés de l\'onglet Semaine. Il touche une ligne, lance un minuteur de 10 minutes, ouvre l\'exercice lié, puis coche.',
        'La barre de recherche et les matières pour retrouver un exercice. En mode parent (après le code), la même barre propose aussi : créer un exercice avec le texte tapé, l\'ajouter à la semaine, ou l\'envoyer comme demande à l\'IA.',
        '« J\'ai fini ! » : il montre ses étoiles gagnées ; un parent les valide avec le code.',
        '« Espace parents » : protégé par le code parents (Réglages).'],
      astuce: 'Le mode parent reste ouvert jusqu\'à « Verrouiller » ou la validation des étoiles : pensez à verrouiller avant de rendre le téléphone.' },
    semaine: { titre: 'Semaine', icone: '📅',
      quoi: 'Préparer les devoirs donnés par la maîtresse pour toute la semaine, et savoir ce qu\'il reste à préparer.',
      comment: ['« Ajouter les devoirs de la semaine » : prenez l\'agenda en photo ou tapez les devoirs ; l\'IA les range par jour de remise (pas d\'école le mercredi).',
        'Chaque devoir liste ce qu\'il faut préparer (photo de la leçon, exercice, matériel, signature…). Touchez un besoin quand il est prêt : il passe au vert.',
        '« Préparer l\'exercice » crée un exercice à partir d\'une photo ou du texte, et le relie au devoir. Ou reliez un exercice existant.',
        'La note entre parents sert à vous répartir le travail (« je m\'en occupe mardi »).',
        'Les flèches en haut changent de semaine. Le week-end, c\'est la semaine qui vient qui s\'affiche.'],
      fael: 'Le soir, Faël voit sur son accueil les devoirs du prochain jour d\'école, dans l\'ordre, avec l\'exercice à faire.',
      astuce: 'Le résumé en haut (« 3 choses à préparer ») se met au vert quand tout est prêt.' },
    exercices: { titre: 'Exercices', icone: '✏️',
      quoi: 'Créer de nouveaux exercices et demander des changements à l\'IA.',
      comment: ['« À partir d\'une photo ou d\'un texte » : photographiez la leçon ; l\'IA la lit, puis prépare l\'exercice. Il est disponible tout de suite.',
        'Saisie directe : mots de dictée, conjugaison, vocabulaire anglais ou questions à choix, que vous tapez vous-même.',
        '« Une demande, un retour ? » : écrivez ce qui ne va pas (« trop dur », « moins de questions »…). L\'IA applique tout de suite ce qui relève des réglages ou corrige l\'exercice choisi ; c\'est annulable.',
        'Pour modifier un exercice : barre de recherche de l\'accueil en mode parent (crayon à côté), ou le cadenas pendant une séance.'],
      fael: 'Faël ne tape jamais de mot : il répond en choisissant. L\'écriture se fait sur papier.',
      astuce: 'Chaque modification garde l\'ancienne version : « Versions précédentes » dans l\'exercice permet de revenir en arrière.' },
    etoiles: { titre: 'Étoiles et récompenses', icone: '⭐',
      quoi: 'Le système de motivation : Faël gagne des étoiles, vous les validez, il les échange contre des récompenses que vous choisissez.',
      comment: ['Une étoile par bonne réponse, 2 de bonus en fin de séance, 2 par devoir coché, 2 par réponse juste au défi.',
        'Les étoiles s\'affichent tout de suite chez Faël, puis attendent votre validation : « Valider les étoiles », où vous pouvez décocher une séance bâclée.',
        'Les récompenses : créez-les avec une image et un prix. Repère : une séance rapporte 5 à 12 étoiles.',
        '« Faël a choisi » : quand il peut s\'offrir une récompense, il la choisit ; vous la donnez (les étoiles sont alors retirées) ou répondez « pas maintenant ».',
        'Le résumé et le graphique montrent ce qu\'il gagne par semaine ; « déjà obtenues » garde l\'historique.'],
      fael: 'Sa tirelire est en haut de l\'accueil ; en la touchant, il voit les récompenses, leur jauge et ce qu\'il a déjà gagné.',
      astuce: 'La pastille sur l\'onglet Étoiles signale qu\'il y a quelque chose à valider ou une récompense choisie.' },
    carnet: { titre: 'Carnet de bord', icone: '📓',
      quoi: 'Votre journal de suivi, partagé entre parents, pour repérer ce qui aide Faël et ce qui le gêne.',
      comment: ['Une note en quelques secondes : qui écrit, concentration, humeur, autonomie et sommeil de 1 à 5, et une remarque. Plusieurs notes par jour possibles.',
        'Vous pouvez aussi noter au moment de valider les étoiles.',
        'Bilans de la semaine et du mois : moyennes, résultats des exercices, alertes, et une lecture par l\'IA.',
        'Alerte automatique si un critère reste à 2 ou moins trois jours de suite.',
        '« Discuter du carnet avec l\'IA » : un fil à part qui connaît les notes récentes (sans le prénom).',
        'Bilans automatiques par courriel : chaque dimanche et chaque 1er du mois.'],
      astuce: 'Les notes du carnet nourrissent aussi les Conseils : plus vous notez, plus les réponses de l\'IA sont adaptées.' },
    conseils: { titre: 'Conseils', icone: '💬',
      quoi: 'Comprendre le TDA et trouver des pistes concrètes, appuyées sur des recherches vérifiées.',
      comment: ['« Discuter » : posez vos questions à l\'IA ; elle s\'appuie sur la base de recherches et sur l\'état récent du carnet. Cochez « recherche web » pour des sources en direct.',
        '« L\'essentiel » : les points clés en une page.',
        '« Approfondir » : recommandations officielles et études, avec leur niveau de preuve.',
        '« Dans l\'appli » : comment chaque principe est appliqué ici, avec un contrôle automatique sur les résultats réels.'],
      astuce: 'Pas de conseil médical : pour un traitement ou un diagnostic, l\'IA renvoie vers le médecin.' },
    reglages: { titre: 'Réglages', icone: '⚙️',
      quoi: 'Adapter les séances à Faël et gérer le lien avec le moteur.',
      comment: ['Mode concentration : questions par série (5 conseillé), nombre de séries, pauses qui bougent, lecture à voix haute, mode calme.',
        'Code parents : protège l\'espace parents et la validation des étoiles.',
        'Intelligence artificielle : « Tester les capacités » vérifie que l\'IA répond et lit les photos.',
        'Demandes et retours : tout ce que vous avez demandé à l\'IA, annulable.',
        'Relier l\'appli au moteur : une fois par téléphone.'] },
    valider: { titre: 'Valider les étoiles', icone: '✅',
      quoi: 'Confirmer les étoiles gagnées par Faël avant qu\'elles entrent dans sa tirelire.',
      comment: ['Toutes les étoiles en attente sont cochées : décochez celles qui ne doivent pas compter.',
        'Ajoutez si vous voulez une note pour le carnet (facultatif).',
        '« Valider et revenir à l\'accueil » : les étoiles passent dans la tirelire, l\'espace parents se referme et le téléphone revient à Faël.'] },
    seance: { titre: 'Pendant une séance (cadenas)', icone: '🔒',
      quoi: 'Intervenir pendant que Faël travaille, sans perdre sa séance.',
      comment: ['Le cadenas en haut à droite d\'un exercice ouvre le mode parent par-dessus la séance (code demandé).',
        '« Comment lui expliquer autrement ? » : 3 façons d\'expliquer la notion, pour vous, plus le piège fréquent.',
        '« Modifier l\'exercice » : corrigez en direct ; les changements comptent dès la séance suivante.',
        '« Donner un retour à l\'IA » : signalez un problème sur cet exercice.'],
      fael: 'Pour Faël, chaque question a un coup de pouce (la règle, jamais la réponse) et « Explique-moi autrement » (4 explications de l\'IA, qui défilent ensuite). En cas d\'erreur, la bonne réponse s\'affiche et il continue. En fin de série, un défi facultatif rapporte des étoiles en plus.' }
  };
  const ORDRE_AIDE = ['accueil', 'semaine', 'exercices', 'etoiles', 'carnet', 'conseils', 'reglages', 'valider', 'seance'];
  function blocAide(cle, ouvert) {
    const a = AIDE[cle];
    return el('details', { class: 'carte aide-section', open: ouvert || null },
      el('summary', { class: 'sommaire' }, el('span', { 'aria-hidden': 'true', text: a.icone + ' ' }), a.titre),
      el('div', { class: 'aide-corps' },
        el('p', {}, el('b', { text: 'À quoi ça sert : ' }), a.quoi),
        el('b', { text: 'Comment ça marche :' }),
        el('ul', {}, a.comment.map(t => el('li', { text: t }))),
        a.fael ? el('p', {}, el('b', { text: 'Ce que voit Faël : ' }), a.fael) : null,
        a.astuce ? el('p', { class: 'muted petit' }, el('b', { text: 'Astuce : ' }), a.astuce) : null));
  }
  /* Le « ? » d'une section : son explication en premier, puis toutes les autres */
  function ouvrirAide(cle) {
    const v = voile('Aide');
    v.corps.replaceChildren(
      cle && AIDE[cle] ? blocAide(cle, true) : null,
      el('button', { class: 'btn plein large', type: 'button', text: '🧭 Lancer la visite guidée', onclick: () => { v.remove(); lancerVisite(); } }),
      el('h3', { text: cle ? 'Toutes les sections' : 'Toutes les explications' }),
      ...ORDRE_AIDE.filter(k => k !== cle).map(k => blocAide(k, false)));
  }
  const boutonAide = cle => el('button', { class: 'rond aide-btn', type: 'button', 'aria-label': 'Aide : ' + (AIDE[cle] ? AIDE[cle].titre : 'explications'), text: '?', onclick: () => ouvrirAide(cle) });

  /* Visite guidée : parcourt les écrans, se relance à tout moment (aide ou Réglages) */
  const ETAPES_VISITE = [
    { route: '#/', cle: 'accueil', texte: 'Voici l\'accueil de Faël : sa tirelire, ses devoirs du soir, la recherche et « J\'ai fini ! ». En mode parent, la barre de recherche vous propose aussi des actions.' },
    { route: '#/p/semaine', cle: 'semaine', texte: 'La Semaine : photographiez l\'agenda, l\'IA range les devoirs par jour. Les besoins passent au vert quand ils sont prêts ; Faël voit chaque soir ceux du lendemain.' },
    { route: '#/p/exercices', cle: 'exercices', texte: 'Exercices : créez un exercice depuis une photo de leçon ou en saisie directe, et demandez des changements à l\'IA (annulables).' },
    { route: '#/p/etoiles', cle: 'etoiles', texte: 'Étoiles : validez les étoiles gagnées, gérez les récompenses, donnez celles que Faël a choisies, suivez ce qu\'il gagne chaque semaine.' },
    { route: '#/p/carnet', cle: 'carnet', texte: 'Carnet de bord : une note rapide (1 à 5) quand vous voulez, des bilans, des alertes, et un fil de discussion avec l\'IA. Bilans aussi par courriel.' },
    { route: '#/p/conseils', cle: 'conseils', texte: 'Conseils : discutez avec l\'IA (base de recherches + état récent du carnet), ou lisez l\'essentiel et l\'approfondi.' },
    { route: '#/p/reglages', cle: 'reglages', texte: 'Réglages : longueur des séances, pauses, voix, code parents, test de l\'IA et lien avec le moteur.' },
    { route: '#/p/reglages', cle: 'seance', texte: 'Pendant un exercice, le cadenas en haut à droite ouvre le mode parent sans interrompre Faël. Et le « ? » en haut de chaque écran réexplique tout. Bonne découverte !' }
  ];
  function lancerVisite(k = 0) {
    document.querySelectorAll('.visite').forEach(x => x.remove());
    const e = ETAPES_VISITE[k]; if (!e) return;
    parentOk = true;
    if (location.hash !== e.route) location.hash = e.route; else router();
    const fin = () => { document.querySelectorAll('.visite').forEach(x => x.remove()); store.set('visiteFaite', true); document.body.classList.remove('en-visite'); };
    setTimeout(() => {
      document.body.classList.add('en-visite');
      document.querySelectorAll('.onglets a').forEach(a => a.classList.toggle('repere', a.getAttribute('href') === e.route));
      document.body.append(el('div', { class: 'visite', role: 'dialog', 'aria-label': 'Visite guidée', 'data-route': e.route },
        el('div', { class: 'visite-tete' }, el('b', { text: (AIDE[e.cle] ? AIDE[e.cle].icone + ' ' + AIDE[e.cle].titre : '') }), el('small', { text: (k + 1) + ' / ' + ETAPES_VISITE.length })),
        el('p', { text: e.texte }),
        el('div', { class: 'visite-boutons' },
          el('button', { class: 'btn discret', type: 'button', text: 'Quitter', onclick: fin }),
          k > 0 ? el('button', { class: 'btn', type: 'button', text: '‹ Avant', onclick: () => lancerVisite(k - 1) }) : null,
          k < ETAPES_VISITE.length - 1 ? el('button', { class: 'btn plein', type: 'button', text: 'Suivant ›', onclick: () => lancerVisite(k + 1) })
            : el('button', { class: 'btn plein', type: 'button', text: 'Terminer', onclick: () => { fin(); location.hash = '#/p/semaine'; } }))));
    }, 250);
  }
  function pageP(titre, actif, droite, ...k) { page(tete(titre, '#/', el('span', { class: 'tete-droite' }, droite || null, boutonAide(titre === 'Valider les étoiles' ? 'valider' : actif))), moteurAJour() ? null : el('p', { class: 'alerte', text: '⚠️ Le moteur n\'est pas à jour : redéploie le code v5.2 dans Apps Script (Gérer les déploiements → Nouvelle version). Sans lui, la semaine, le carnet et la validation des étoiles ne marchent pas.' }), ...k, navParents(actif)); document.body.classList.add('avec-onglets'); }

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
    const etat = { s: 0, i: 0, essai: 1, journal: [], etoiles: 0, etoilesDefi: 0, defi: null, debut: Date.now(), tq: Date.now() };
    /* « Explique-moi autrement » : jusqu'à 4 explications de l'IA par question, puis elles défilent de la 1re à la 4e */
    const explications = {}, vues = {};
    const retour = test ? '#/p/contenu/' + c.id : '#/';
    /* Cadenas : un parent ouvre le mode parent par-dessus la séance, sans la perdre */
    const droiteSeance = () => el('span', { class: 'tete-droite' }, badgeEtoiles(), test ? null : el('button', { class: 'rond', type: 'button', 'aria-label': 'Mode parent', text: '🔒', onclick: () => modeParentSeance(c, etat.q) }));

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
      page(tete(c.titre, retour, droiteSeance()), el('section', { class: 'carte cahier' }, el('h2', { text: 'Je retiens' }), zone),
        el('button', { class: 'btn discret large', type: 'button', text: 'Passer la leçon', onclick: question }));
      afficher();
    }

    function question() {
      const lot = series[etat.s], q = lot[etat.i]; etat.q = q;
      etat.essai = 1; etat.tq = Date.now();
      const points = el('div', { class: 'points', 'aria-hidden': 'true' }, lot.map((_, k) => el('i', { class: k < etat.i ? 'fait' : k === etat.i ? 'cours' : '' })));
      const libSerie = q.defi ? '🏆 Défi · question ' + (etat.i + 1) + ' sur ' + lot.length : q.revoir ? 'Je revois mes erreurs' : 'Série ' + (etat.s + 1 - (series[0][0] && series[0][0].revoir ? 1 : 0)) + ' sur ' + series.filter(l => !l[0].revoir).length;
      const zoneRep = el('div'), zoneRetour = el('div'), zoneAide = el('div'), zoneExpl = el('div');
      /* Coup de pouce et explication de l'IA ont chacun leur place : on peut voir les deux en même temps */
      const ecouter = () => dire([{ texte: q.consigne }, ...(q.dire || [])]);
      const bExpl = outil('bulle', (vues[q.cle] || 0) ? 'Encore autrement' : 'Explique-moi', 'o-expl', expliquer);
      const outils = el('div', { class: 'outils' },
        outil('son', 'Écouter', 'o-son', ecouter),
        q.defi ? null : outil('ampoule', 'Coup de pouce', 'o-pouce', () => zoneAide.replaceChildren(el('div', { class: 'aide' }, el('b', { text: 'Coup de pouce : ' }), q.aide))),
        q.defi || !D.mistral ? null : bExpl);
      async function expliquer() {
        const k = vues[q.cle] || 0, liste = explications[q.cle] = explications[q.cle] || [];
        vues[q.cle] = k + 1; bExpl.querySelector('.lib-outil').textContent = 'Encore autrement';
        const montrer = i => {
          const t = liste[i];
          zoneExpl.replaceChildren(el('div', { class: 'explique', role: 'status' },
            el('div', { class: 'explique-tete' }, el('b', { text: '💬 Une autre façon de comprendre' }), el('small', { text: (i + 1) + ' sur 4' })),
            el('p', { text: t }), el('button', { class: 'btn discret', type: 'button', text: '🔊 Écouter l\'explication', onclick: () => dire([{ texte: t }]) })));
          dire([{ texte: t }]);
        };
        if (k >= 4) return montrer(k % 4);
        if (liste[k]) return montrer(k);
        bExpl.disabled = true;
        zoneExpl.replaceChildren(el('div', { class: 'explique attente', role: 'status' }, el('p', { text: 'Je cherche une façon de t\'expliquer…' })));
        try {
          const r2 = await api('expliquerAutrement', { contenu: c.id, consigne: String(q.consigne || '').replace(/\*\*/g, ''), question: q.enonce || '', choix: q.choix || q.etiquettes || [], bonne: q.bonne, n: k + 1, precedentes: liste.slice() });
          liste[k] = r2.texte; montrer(k);
        } catch (e) { vues[q.cle] = k; zoneExpl.replaceChildren(el('div', { class: 'aide', text: 'Pas d\'explication pour l\'instant (réseau ?). Essaie le coup de pouce.' })); }
        bExpl.disabled = false;
      }
      function repondre(rep, bouton) {
        const juste = estJuste(q, rep);
        etat.journal.push({ contenu: c.id, question: q.cle, reponse: rep, juste, essai: etat.essai, duree_s: Math.round((Date.now() - etat.tq) / 1000) });
        if (juste) {
          if (q.defi) etat.etoilesDefi += 2; else etat.etoiles++;
          if (q.revoir) noterReussite(c.id, q.cle);
          if (bouton) bouton.classList.add('juste');
          verrouiller();
          zoneRetour.replaceChildren(el('div', { class: 'retour ok', role: 'status' },
            el('b', { class: 'titre', text: q.defi ? 'Défi réussi !' : 'Bravo !' }), el('span', { class: 'plus1', text: q.defi ? '+2 étoiles ★★' : '+1 étoile ★' }), el('span', { text: q.explication }),
            el('button', { class: 'btn plein large', type: 'button', text: 'Continuer', onclick: suivant })));
          zoneRetour.querySelector('button').focus();
        } else {
          /* Erreur : la case choisie devient orangée, la bonne réponse s'affiche en vert, et on continue */
          if (!test && !q.defi) noterErreur(c.id, q.cle);
          if (bouton) bouton.classList.add('faux');
          verrouiller(true);
          zoneAide.replaceChildren(); zoneExpl.replaceChildren();
          zoneRetour.replaceChildren(el('div', { class: 'retour ko', role: 'status' },
            el('b', { class: 'titre', text: 'On regarde ensemble' }), el('span', {}, 'La bonne réponse : ', el('b', { text: q.bonne })), el('span', { text: q.explication }),
            el('span', { class: 'muted petit', text: q.defi ? 'C\'était un vrai défi : bravo d\'avoir essayé !' : 'Cette question reviendra pour t\'entraîner.' }),
            el('button', { class: 'btn plein large', type: 'button', text: 'Continuer', onclick: suivant })));
          zoneRetour.querySelector('button').focus();
        }
      }
      function verrouiller(montrer) {
        zoneRep.querySelectorAll('button,input').forEach(b => { b.disabled = true; if (montrer && b.dataset.v === q.bonne) b.classList.add('juste'); });
      }
      if (q.mode === 'ordre') {
        const pris = [], ligne = el('div', { class: 'phrase-construite', 'aria-live': 'polite' }), tas = el('div', { class: 'etiquettes' });
        const dessinerOrdre = () => {
          ligne.replaceChildren(...(pris.length ? pris.map((k, i) => el('button', { class: 'etiquette posee', type: 'button', text: q.etiquettes[k], 'aria-label': 'Retirer ' + q.etiquettes[k], onclick: () => { pris.splice(i, 1); dessinerOrdre(); } })) : [el('span', { class: 'muted petit', text: 'Ta phrase se construit ici.' })]));
          tas.replaceChildren(...q.etiquettes.map((m, k) => pris.includes(k) ? null : el('button', { class: 'etiquette', type: 'button', text: m, onclick: () => { pris.push(k); dessinerOrdre(); if (pris.length === q.etiquettes.length) repondre(pris.map(x => q.etiquettes[x]).join(' '), null); } })).filter(Boolean));
        };
        dessinerOrdre();
        zoneRep.replaceChildren(ligne, tas);
      }
      if (q.mode === 'choix') {
        zoneRep.replaceChildren(el('div', { class: 'choix' + (q.choix.some(x => x.length > 22) ? ' un' : '') },
          q.choix.map(ch => el('button', { class: 'btn', type: 'button', 'data-v': ch, text: ch, onclick: e => { if (q.direChoix) dire([{ texte: ch, lang: q.direChoix }]); repondre(ch, e.currentTarget); } }))));
      }
      page(tete(c.titre, retour, droiteSeance()),
        el('div', { class: 'progression' }, el('span', { text: libSerie }), points),
        el('section', { class: 'carte cahier' },
          el('p', { class: 'consigne' }, el('span', { class: 'lib', text: 'Consigne' }), ' : ', riche(q.consigne)),
          !q.enonce ? null : el('p', { class: 'enonce' }, q.enonce.split('____').map((p, k, a) => [p, k < a.length - 1 ? el('span', { class: 'trou', 'aria-label': 'à compléter' }) : null])),
          outils, el('div', { class: 'aides' }, zoneAide, zoneExpl), zoneRep, zoneRetour));
      if (R().voix && etat.i === 0) setTimeout(ecouter, 300);
    }

    function suivant() {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      etat.i++;
      if (etat.i < series[etat.s].length) return question();
      etat.s++; etat.i = 0;
      if (etat.s >= series.length) return etat.defi === null && !test ? proposerDefi() : bilan();
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

    /* Petite fenêtre : le défi est proposé, jamais imposé */
    function proposerDefi() {
      const qs = defis(c); etat.defi = false;
      if (!qs.length) return bilan();
      const v = el('div', { class: 'voile centre', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Défi' }, el('div', { class: 'feuille defi' },
        el('span', { class: 'grand', 'aria-hidden': 'true', text: '🏆' }), el('h2', { text: 'Un défi pour toi ?' }),
        el('p', { text: qs.length + ' questions beaucoup plus difficiles, sans coup de pouce.' }),
        el('p', {}, 'Chaque bonne réponse rapporte ', el('b', { text: '2 étoiles de plus' }), '. Si tu te trompes, tu ne perds rien.'),
        el('button', { class: 'btn plein large', type: 'button', text: 'Je relève le défi !', onclick: () => { v.remove(); etat.defi = true; series.push(qs); etat.s = series.length - 1; etat.i = 0; question(); } }),
        el('button', { class: 'btn discret large', type: 'button', text: 'Non merci, j\'ai fini', onclick: () => { v.remove(); bilan(); } })));
      document.body.append(v);
      dire([{ texte: 'Un défi pour toi ? ' + qs.length + ' questions plus difficiles, sans coup de pouce. Chaque bonne réponse rapporte 2 étoiles de plus.' }]);
    }

    function bilan() {
      const jn = etat.journal.filter(x => !String(x.question).startsWith('d:')), jd = etat.journal.filter(x => String(x.question).startsWith('d:'));
      const premiers = jn.filter(x => x.juste).length, j = etat.journal;
      const total = series.filter(l => !l[0].defi).reduce((s, l) => s + l.length, 0);
      const bonus = test ? 0 : 2; const gagne = etat.etoiles + etat.etoilesDefi + bonus;
      const phrase = premiers === total ? 'Tout juste ! Tu as été très concentré.' :
        'Tu as trouvé ' + premiers + ' réponses sur ' + total + '. Les autres reviendront pour t\'entraîner.';
      if (!test) envoyer({ resultats: j.map(x => Object.assign({ horodatage: new Date().toISOString().slice(0, 19).replace('T', ' ') }, x)), etoiles: gagne, motif: 'Séance : ' + c.titre })
        .then(() => { const b = $('.etoiles'); if (b && D) b.replaceWith(badgeEtoiles()); });
      if (D && !test) { D.attente = (D.attente || 0) + gagne; store.set('donnees', D); }
      page(tete('Bilan', retour, badgeEtoiles()), el('section', { class: 'carte bilan' },
        el('h2', { text: 'Séance terminée' }), el('span', { class: 'gros', text: '+' + gagne + ' ★' }),
        el('p', { text: phrase }),
        jd.length ? el('p', { class: 'defi-bilan', text: '🏆 Défi : ' + jd.filter(x => x.juste).length + ' sur ' + jd.length + (etat.etoilesDefi ? ' · +' + etat.etoilesDefi + ' étoiles' : ' · bravo d\'avoir essayé') }) : null,
        bonus ? el('p', { class: 'muted petit', text: 'Dont 2 étoiles bonus pour avoir fini la séance.' }) : el('p', { class: 'muted petit', text: 'Mode essai : rien n\'est enregistré.' }),
        test ? el('a', { class: 'btn plein large', href: retour, text: 'Retour au contenu' }) : el('a', { class: 'btn ok large', href: '#/fini', text: '🎉 J\'ai fini !' }),
        test ? null : el('a', { class: 'btn large', href: '#/', text: 'J\'ai encore des devoirs à faire ici' })));
      dire([{ texte: 'Séance terminée. ' + phrase }]);
    }

    lecon();
  }

  function anneau(C) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 150 150'); svg.setAttribute('class', 'anneau'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle class="fond" cx="75" cy="75" r="62"></circle><circle class="reste" cx="75" cy="75" r="62" stroke-dasharray="' + C + '" stroke-dashoffset="0" transform="rotate(-90 75 75)"></circle><text x="75" y="85" text-anchor="middle"></text>';
    return svg;
  }

  /* ---------- Semaine : les devoirs donnés pour la semaine, et ce qu'il faut préparer ---------- */
  const BESOINS = ['photo de la leçon', 'exercice d\'entraînement', 'appris', 'signature', 'matériel'];
  const sauverTache = t => api('enregistrerTache', { tache: t });
  async function ecranSemaine(lundi) {
    lundi = /^\d{4}-\d{2}-\d{2}$/.test(lundi || '') ? lundiDe(lundi) : lundiCourant();
    const dim = decale(lundi, 6), dl = dateJ(lundi), dd = dateJ(dim);
    const zone = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement de la semaine…' }));
    const resume = el('div');
    const nav = el('div', { class: 'semaine-nav' },
      el('a', { class: 'rond', href: '#/p/semaine/' + decale(lundi, -7), 'aria-label': 'Semaine précédente', text: '‹' }),
      el('b', { text: 'Du ' + dl.getDate() + (dl.getMonth() !== dd.getMonth() ? ' ' + MOIS[dl.getMonth()] : '') + ' au ' + dd.getDate() + ' ' + MOIS[dd.getMonth()] }),
      el('a', { class: 'rond', href: '#/p/semaine/' + decale(lundi, 7), 'aria-label': 'Semaine suivante', text: '›' }));

    /* Saisie de la semaine : photo de l'agenda ou du cahier de textes, ou texte tapé */
    const photo = el('input', { type: 'file', accept: 'image/*' }), apercu = el('div'), etat = el('p', { class: 'muted petit' });
    const texte = el('textarea', { style: 'min-height:90px', placeholder: 'Tape ou colle les devoirs de la semaine (ex. : « Jeudi : apprendre la leçon sur les noms. Vendredi : dictée des mots en bleu »). Ou prends l\'agenda en photo.' });
    let image = null;
    photo.addEventListener('change', async () => { const f = photo.files && photo.files[0]; if (!f) return; image = await reduire(f); apercu.replaceChildren(el('img', { src: image.apercu, alt: '', style: 'max-width:140px;border-radius:8px' })); });
    const decouper = el('button', { class: 'btn plein', type: 'button', text: '✨ Ranger par jour avec l\'IA', disabled: !D.mistral, onclick: async () => {
      if (!texte.value.trim() && !image) return toast('Ajoute une photo ou un texte.', true);
      decouper.disabled = true; etat.textContent = 'L\'IA lit et range les devoirs…';
      try { const r = await api('analyserSemaine', { lundi, texte: texte.value.trim(), photoBase64: image && image.b64 }); etat.textContent = r.ajoutees + ' tâche' + (r.ajoutees > 1 ? 's ajoutées' : ' ajoutée') + '. Vérifie-les ci-dessous.'; texte.value = ''; image = null; apercu.replaceChildren(); photo.value = ''; await dessiner(); charger(); }
      catch (e) { etat.textContent = e.message; }
      decouper.disabled = !D.mistral;
    } });
    const formZone = el('div');
    const saisie = el('details', { class: 'carte', open: !!(prepa && prepa.titre) }, el('summary', { class: 'sommaire', text: '➕ Ajouter les devoirs de la semaine' }),
      el('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:10px' },
        el('div', { class: 'champ' }, 'Photo de l\'agenda (facultatif)', boutonsPhoto(photo)), apercu, texte, decouper, etat,
        el('button', { class: 'btn discret', type: 'button', text: 'Ou ajouter une tâche à la main', onclick: () => formTache({ jour: prochainJourEcole() >= lundi && prochainJourEcole() <= dim ? prochainJourEcole() : lundi }) }), formZone));

    function formTache(t) {
      const jours = [0, 1, 2, 3, 4, 5, 6].map(n => decale(lundi, n));
      const sj = el('select', { 'aria-label': 'Pour quel jour' }, jours.map(j => el('option', { value: j, text: 'Pour ' + nomJour(j), selected: j === t.jour })));
      const ti = el('input', { value: t.titre || '', placeholder: 'Ex. : Apprendre la leçon sur les noms' });
      const ma = el('select', {}, ['', ...MATIERES].map(m => el('option', { value: m, text: m || 'Matière…', selected: m === (t.matiere || '') })));
      const de = el('textarea', { style: 'min-height:70px', placeholder: 'Détails (facultatif)' }); de.value = t.details || '';
      const deja = (t.besoins || []).map(b => b.libelle);
      const cases = BESOINS.map(b => { const c = el('input', { type: 'checkbox', checked: deja.includes(b) }); c.lib = b; return c; });
      formZone.replaceChildren(el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' },
        el('h2', { text: t.id ? 'Modifier la tâche' : 'Nouvelle tâche' }), sj, el('label', { class: 'champ' }, 'Le devoir', ti), ma, de,
        el('fieldset', { class: 'besoins-choix' }, el('legend', { text: 'À préparer' }), cases.map(c => el('label', {}, c, ' ' + c.lib))),
        el('div', { class: 'rangee' }, el('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => formZone.replaceChildren() }),
          el('button', { class: 'btn plein', type: 'button', text: 'Enregistrer', onclick: async () => {
            if (!ti.value.trim()) return ti.focus();
            const anciens = t.besoins || [];
            const besoins = cases.filter(c => c.checked).map(c => anciens.find(b => b.libelle === c.lib) || { libelle: c.lib, fait: false });
            try { await sauverTache(Object.assign({}, t, { jour: sj.value, titre: ti.value.trim(), matiere: ma.value, details: de.value.trim(), besoins })); formZone.replaceChildren(); toast('Enregistré.'); await dessiner(); charger(); }
            catch (e) { toast(e.message, true); } } }))));
      saisie.open = true; formZone.scrollIntoView({ behavior: 'smooth', block: 'start' }); ti.focus();
    }

    function carteTache(t) {
      const besoins = t.besoins || [];
      const note = el('textarea', { class: 'note', placeholder: 'Note entre parents (ex. : « Je m\'en occupe mardi »)', 'aria-label': 'Note entre parents' }); note.value = t.note || '';
      note.addEventListener('change', () => { t.note = note.value.trim(); sauverTache(t).then(() => toast('Note enregistrée.')).catch(e => toast(e.message, true)); });
      const lie = t.contenu && contenu(t.contenu);
      const choix = el('select', { 'aria-label': 'Relier un exercice existant' }, el('option', { value: '', text: 'Relier un exercice existant…' }), contenus().map(c => el('option', { value: c.id, text: c.titre })));
      choix.addEventListener('change', async () => { if (!choix.value) return; t.contenu = choix.value; besoins.forEach(b => { if (/exercice/.test(b.libelle)) b.fait = true; }); try { await sauverTache(t); dessiner(); charger(); } catch (e) { toast(e.message, true); } });
      const reste = besoins.filter(b => !b.fait).length;
      return el('section', { class: 'carte tache' + (besoins.length && !reste ? ' prete' : '') },
        el('div', { class: 'tache-tete' }, el('b', { text: t.titre }), t.statut === 'fait' ? el('span', { class: 'badge ok', text: 'fait par Faël' }) : null),
        t.matiere || t.details ? el('p', { class: 'muted petit', text: [t.matiere, t.details].filter(Boolean).join(' · ') }) : null,
        besoins.length ? el('div', { class: 'besoins' }, besoins.map(b => el('button', { class: 'besoin' + (b.fait ? ' ok' : ''), type: 'button', 'aria-pressed': String(!!b.fait), onclick: async () => {
          b.fait = !b.fait; try { await sauverTache(t); dessiner(); } catch (e) { b.fait = !b.fait; toast(e.message, true); } } }, b.fait ? '✓ ' : '○ ', b.libelle))) : null,
        lie ? el('a', { class: 'btn discret', href: '#/p/contenu/' + lie.id, text: '✏️ ' + lie.titre })
          : el('div', { class: 'rangee' }, el('button', { class: 'btn', type: 'button', text: '📷 Préparer l\'exercice', onclick: () => { prepa = { texte: [t.titre, t.details].filter(Boolean).join('\n'), tache: t, retour: '#/p/semaine/' + lundi }; location.hash = '#/p/generer'; } }), choix),
        note,
        el('div', { class: 'rangee petit' }, el('button', { class: 'btn discret', type: 'button', text: 'Modifier', onclick: () => formTache(t) }),
          el('button', { class: 'btn discret', type: 'button', text: 'Retirer', onclick: async () => { if (!confirm('Retirer « ' + t.titre + ' » ?')) return; try { await sauverTache(Object.assign({}, t, { statut: 'archivé' })); dessiner(); charger(); } catch (e) { toast(e.message, true); } } })));
    }

    async function dessiner() {
      let taches;
      try { taches = await api('semaine', { lundi }); } catch (e) { zone.replaceChildren(el('p', { class: 'vide', text: 'Semaine indisponible hors ligne.' })); return; }
      const aPreparer = []; taches.forEach(t => (t.besoins || []).forEach(b => { if (!b.fait) aPreparer.push(b.libelle + ' (' + t.titre + ')'); }));
      resume.replaceChildren(taches.length ? el('div', { class: 'retour ' + (aPreparer.length ? 'info' : 'ok') },
        el('b', { text: aPreparer.length ? aPreparer.length + ' chose' + (aPreparer.length > 1 ? 's' : '') + ' à préparer' : 'Tout est prêt pour la semaine 🟢' }),
        aPreparer.length ? el('span', { class: 'petit', text: aPreparer.slice(0, 6).join(' · ') + (aPreparer.length > 6 ? '…' : '') }) : null) : '');
      const parJour = {}; taches.forEach(t => (parJour[t.jour] = parJour[t.jour] || []).push(t));
      const jours = [0, 1, 2, 3, 4, 5, 6].map(n => decale(lundi, n)).filter(j => parJour[j] || ![0, 3, 6].includes(dateJ(j).getDay()));
      zone.replaceChildren(...jours.map(j => el('div', { class: 'jour' + (j === jour() ? ' aujourdhui' : '') },
        el('h3', { text: 'Pour ' + nomJour(j) + (j === prochainJourEcole() ? ' · Faël le voit ce soir' : '') }),
        parJour[j] ? parJour[j].map(carteTache) : el('p', { class: 'muted petit', text: 'Rien de prévu.' }))));
    }
    pageP('Semaine', 'semaine', el('button', { class: 'rond', type: 'button', 'aria-label': 'Actualiser', text: '↻', onclick: () => dessiner() }),
      nav, resume, saisie, zone);
    if (prepa && prepa.titre) { const t = prepa.titre; prepa = null; formTache({ jour: prochainJourEcole(), titre: t }); }
    await dessiner();
  }

  function ecranAide() {
    pageP('Aide', 'reglages', null,
      el('p', { class: 'muted', text: 'À quoi sert chaque partie de l\'appli, et comment elle fonctionne. Le « ? » en haut de chaque écran ouvre directement la bonne explication.' }),
      el('button', { class: 'btn plein large', type: 'button', text: '🧭 Lancer la visite guidée', onclick: () => lancerVisite(0) }),
      ...ORDRE_AIDE.map(k => blocAide(k, false)));
  }

  /* ---------- Exercices : ajouter, demander un changement ---------- */
  const AIDES_TYPES = { mots: 'Liste de mots de dictée', conjugaison: 'Un verbe, un temps, ses formes', vocabulaire: 'Mots en français et en anglais', qcm: 'Questions à choix, sur n\'importe quelle leçon' };
  function ecranExercices(cidChoisi) {
    const demande = prepa && prepa.demande; prepa = null;
    pageP('Exercices', 'exercices', null,
      el('a', { class: 'tuile', href: '#/p/generer' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '📷' }),
        el('span', {}, el('span', { class: 't', text: 'À partir d\'une photo ou d\'un texte' }), el('span', { class: 's', text: D.mistral ? 'L\'IA lit la leçon et prépare l\'exercice' : 'Lecture de photo sur le téléphone' })), el('span', { class: 'fl', text: '›' })),
      el('h3', { text: 'Saisie directe' }),
      el('div', { class: 'liste' }, Object.keys(TYPES).map(ty => el('a', { class: 'tuile', href: '#/p/nouveau/' + ty },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: ICONES[ty] }), el('span', {}, el('span', { class: 't', text: TYPES[ty] }), el('span', { class: 's', text: AIDES_TYPES[ty] })), el('span', { class: 'fl', text: '›' })))),
      el('p', { class: 'muted petit', text: 'Pour retrouver ou modifier un exercice : la barre de recherche de l\'accueil (✎ à côté de chaque exercice en mode parent), ou le cadenas 🔒 pendant une séance.' }),
      encartDemande(cidChoisi, demande));
  }
  function encartDemande(cidChoisi, texteInitial) {
    const ta = el('textarea', { style: 'min-height:96px', placeholder: 'Ex. : « moins de questions par série », « la dictée d\'hier était trop dure, enlève les mots longs », « ajoute un mode nuit »…' });
    if (texteInitial) ta.value = texteInitial;
    const sel = el('select', { 'aria-label': 'Exercice concerné' }, el('option', { value: '', text: 'Pas d\'exercice précis' }), contenus().map(c => el('option', { value: c.id, text: c.titre, selected: String(c.id) === String(cidChoisi || '') })));
    const rep = el('div');
    const go = el('button', { class: 'btn plein', type: 'button', text: 'Envoyer', onclick: async () => {
      if (!ta.value.trim()) return ta.focus();
      go.disabled = true; go.textContent = D.mistral ? 'L\'IA s\'en occupe…' : 'Envoi…';
      try {
        const d = await api('demande', { texte: ta.value.trim(), contenu: sel.value });
        ta.value = '';
        if (d.statut === 'appliqué') await charger();
        rep.replaceChildren(el('div', { class: 'retour ' + (d.statut === 'appliqué' ? 'ok' : 'info') },
          el('b', { text: d.statut === 'appliqué' ? (d.type === 'reglage' ? 'Réglage appliqué' : 'Exercice corrigé') : 'Noté' }), el('span', { text: d.reponse }),
          d.statut === 'appliqué' ? el('button', { class: 'btn discret', type: 'button', text: 'Annuler ce changement', onclick: async ev => { ev.currentTarget.disabled = true; try { await api('annulerDemande', { id: d.id }); await charger(); rep.replaceChildren(el('p', { class: 'muted petit', text: 'Changement annulé.' })); } catch (e) { toast(e.message, true); } } }) : null));
      } catch (e) { toast(e.message, true); }
      go.disabled = false; go.textContent = 'Envoyer';
    } });
    return el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' },
      el('h2', { text: 'Une demande, un retour ?' }),
      el('p', { class: 'muted petit', text: D.mistral ? 'L\'IA applique tout de suite ce qui relève des réglages ou corrige l\'exercice choisi (annulable). Le reste est noté pour la prochaine session avec Claude.' : 'Ta demande est notée pour la prochaine session avec Claude.' }),
      ta, el('label', { class: 'champ' }, 'À propos de', sel), go, rep,
      el('a', { href: '#/p/demandes', class: 'petit', text: 'Voir toutes les demandes' }));
  }
  async function ecranDemandes() {
    const liste = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    pageP('Demandes et retours', 'exercices', null, liste);
    try {
      const l = await api('demandes');
      liste.replaceChildren(...(l.length ? l.map(d => el('div', { class: 'tuile', style: 'flex-direction:column;align-items:flex-start;gap:6px' },
        el('span', { class: 'petit muted', text: String(d.horodatage).slice(0, 16) + (d.contenu && contenu(d.contenu) ? ' · ' + contenu(d.contenu).titre : '') }),
        el('b', { text: d.texte }), el('span', {}, el('span', { class: 'badge ' + (d.statut === 'appliqué' ? 'ok' : d.statut === 'annulé' ? 'ar' : 'av'), text: d.statut }), ' ', d.reponse || ''),
        d.statut === 'appliqué' ? el('button', { class: 'btn discret', type: 'button', text: 'Annuler ce changement', onclick: async () => { try { await api('annulerDemande', { id: d.id }); await charger(); ecranDemandes(); } catch (e) { toast(e.message, true); } } }) : null))
        : [el('p', { class: 'vide', text: 'Aucune demande pour l\'instant.' })]));
    } catch (e) { liste.replaceChildren(el('p', { class: 'vide', text: 'Indisponible hors ligne.' })); }
  }

  /* ---------- Carnet de bord des parents ---------- */
  const CRITERES = [['concentration', 'Concentration'], ['humeur', 'Humeur'], ['autonomie', 'Autonomie'], ['sommeil', 'Sommeil']];
  const AUTEURS = ['Flavien', 'Manue'];
  function formCarnet(apres, titre, sansBouton) {
    const auteur = el('select', { 'aria-label': 'Qui écrit' }, AUTEURS.map(a => el('option', { value: a, text: a, selected: a === store.get('auteur', 'Flavien') })));
    const notes = {};
    const rangees = CRITERES.map(([k, lib]) => el('div', { class: 'note-ligne' }, el('span', { text: lib }),
      el('div', { class: 'notes', role: 'group', 'aria-label': lib }, [1, 2, 3, 4, 5].map(n => el('button', { type: 'button', 'aria-pressed': 'false', text: String(n), onclick: ev => {
        notes[k] = notes[k] === n ? '' : n; ev.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.textContent) === notes[k]))); } })))));
    const rem = el('textarea', { style: 'min-height:80px', placeholder: 'Ce qui a marché, ce qui a coincé, le contexte (fatigue, sortie, contrôle…)' });
    const go = el('button', { class: 'btn plein', type: 'button', text: 'Noter dans le carnet', onclick: async () => {
      if (!rem.value.trim() && !Object.values(notes).some(Boolean)) return toast('Mets au moins une note ou une remarque.', true);
      store.set('auteur', auteur.value); go.disabled = true;
      try { await api('ajouterCarnet', { entree: Object.assign({ auteur: auteur.value, remarque: rem.value.trim() }, notes) }); toast('Noté.'); apres && apres(); }
      catch (e) { toast(e.message, true); go.disabled = false; }
    } });
    const sec = el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' },
      el('h2', { text: titre || 'Nouvelle note' }), el('label', { class: 'champ' }, 'Qui écrit', auteur),
      el('p', { class: 'muted petit', text: 'De 1 (difficile) à 5 (très bien). Tout est facultatif. Plusieurs notes par jour possibles.' }),
      rangees, el('label', { class: 'champ' }, 'Remarque', rem), sansBouton ? null : go);
    /* Utilisé par la validation des étoiles : l'entrée est enregistrée avec le même bouton */
    sec.entree = () => (!rem.value.trim() && !Object.values(notes).some(Boolean)) ? null : (store.set('auteur', auteur.value), Object.assign({ auteur: auteur.value, remarque: rem.value.trim() }, notes));
    return sec;
  }
  function blocBilan(b) {
    const m = b.moyennes || {}, s = b.stats || {};
    return el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:8px' },
      el('h2', { text: 'Bilan des ' + b.jours + ' derniers jours' }),
      el('div', { class: 'moyennes' }, CRITERES.map(([k, lib]) => el('div', {}, el('b', { text: m[k] == null ? '—' : String(m[k]).replace('.', ',') }), el('small', { text: lib })))),
      el('p', { class: 'muted petit', text: b.entrees + ' note' + (b.entrees > 1 ? 's' : '') + ' dans le carnet' + (s.premiersEssais ? ' · ' + s.reussitePremier + ' % de bonnes réponses du premier coup · ' + s.seances + ' séance' + (s.seances > 1 ? 's' : '') : '') + '.' }),
      (b.alertes || []).map(a => el('p', { class: 'alerte', text: '🟠 ' + a })),
      b.synthese ? el('div', { class: 'retour ok' }, el('b', { class: 'petit', text: 'Lecture de l\'IA' }), el('span', { style: 'white-space:pre-wrap', text: b.synthese })) : null);
  }
  async function ecranCarnet(sous) {
    if (sous === 'discuter') {
      const zone = el('div');
      pageP('Discuter du carnet', 'carnet', el('a', { class: 'rond', href: '#/p/carnet', 'aria-label': 'Retour au carnet', text: '📓' }),
        el('p', { class: 'muted petit', text: 'Un fil à part, réservé au carnet : l\'IA connaît les notes et les résultats récents (sans le prénom) et peut vous alerter sur une tendance.' }), zone);
      return ongletDiscuter(zone, 'carnet');
    }
    const hebdo = el('details', { class: 'carte' }, el('summary', { class: 'sommaire', text: '✉️ Bilans automatiques par courriel' }));
    hebdo.addEventListener('toggle', async () => {
      if (!hebdo.open || hebdo.dataset.ok) return; hebdo.dataset.ok = '1';
      const corps = el('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:8px' }, el('p', { class: 'muted petit', text: 'Chargement…' })); hebdo.append(corps);
      const essai = periode => { const bt = el('button', { class: 'btn discret', type: 'button', text: periode === 'mois' ? 'Essai : bilan du mois' : 'Essai : bilan de la semaine', onclick: async () => {
        bt.disabled = true;
        try { await api('bilanHebdoMaintenant', { periode }); toast('Bilan envoyé : regarde ta boîte mail.'); }
        catch (e) { toast(/permission|autoris|MailApp/i.test(e.message) ? 'Envoi pas encore autorisé : lance une fois « installerBilanHebdo » dans Apps Script.' : e.message, true); }
        bt.disabled = false; } }); return bt; };
      const test = el('div', { class: 'rangee' }, essai('semaine'), essai('mois'));
      let l = [];
      try { l = await api('derniersBilans'); } catch (e) { /* hors ligne */ }
      corps.replaceChildren(
        el('p', { class: 'muted petit', text: 'Chaque dimanche vers 19 h (la semaine) et le 1er de chaque mois vers 19 h (le mois écoulé), le moteur t\'envoie par courriel le bilan : notes du carnet, exercices, étoiles et récompenses, alertes, lecture de l\'IA. À activer une fois : dans Apps Script, choisis la fonction « installerBilanHebdo » puis « Exécuter ».' }),
        l.length ? el('div', { class: 'retour info' }, el('b', { class: 'petit', text: 'Dernier bilan · ' + String(l[0].horodatage).slice(0, 10) }), el('span', { style: 'white-space:pre-wrap', text: l[0].texte })) : el('p', { class: 'muted petit', text: 'Aucun bilan envoyé pour l\'instant.' }),
        test);
    });
    const alertes = el('div'), entrees = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' })), bilanZone = el('div');
    const bilanBtn = periode => el('button', { class: 'btn', type: 'button', text: periode === 'mois' ? 'Bilan du mois' : 'Bilan de la semaine', onclick: async ev => {
      const b = ev.currentTarget; b.disabled = true; bilanZone.replaceChildren(el('p', { class: 'muted petit', text: D.mistral ? 'Calcul et lecture par l\'IA…' : 'Calcul…' }));
      try { bilanZone.replaceChildren(blocBilan(await api('bilan', { periode }))); } catch (e) { bilanZone.replaceChildren(el('p', { class: 'muted petit', text: e.message })); }
      b.disabled = false; } });
    pageP('Carnet de bord', 'carnet', null,
      alertes,
      formCarnet(() => ecranCarnet()),
      el('div', { class: 'rangee' }, bilanBtn('semaine'), bilanBtn('mois')), bilanZone, hebdo,
      el('a', { class: 'tuile', href: '#/p/carnet/discuter' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '🗨️' }), el('span', {}, el('span', { class: 't', text: 'Discuter du carnet avec l\'IA' }), el('span', { class: 's', text: 'Un fil à part, qui connaît les notes récentes' })), el('span', { class: 'fl', text: '›' })),
      el('h3', { text: 'Dernières notes' }), entrees);
    api('bilan', { periode: 'semaine', sansIA: true }).then(b => { if (b.alertes && b.alertes.length) alertes.replaceChildren(el('div', { class: 'retour info' }, el('b', { text: 'À surveiller cette semaine' }), b.alertes.map(a => el('span', { text: '🟠 ' + a })), el('a', { href: '#/p/carnet/discuter', class: 'petit', text: 'En parler avec l\'IA' }))); }).catch(() => {});
    try {
      const l = await api('carnet');
      entrees.replaceChildren(...(l.length ? l.slice(0, 40).map(e => el('div', { class: 'tuile', style: 'flex-direction:column;align-items:flex-start;gap:4px' },
        el('span', { class: 'petit muted', text: String(e.horodatage).slice(0, 16).replace('T', ' ') + (e.auteur ? ' · ' + e.auteur : '') }),
        CRITERES.some(([k]) => e[k]) ? el('span', { class: 'petit', text: CRITERES.filter(([k]) => e[k]).map(([k, lib]) => lib + ' ' + e[k] + '/5').join(' · ') }) : null,
        e.remarque ? el('span', { style: 'white-space:pre-wrap', text: e.remarque }) : null))
        : [el('p', { class: 'vide', text: 'Pas encore de note.' })]));
    } catch (e) { entrees.replaceChildren(el('p', { class: 'muted petit', text: 'Indisponible hors ligne.' })); }
  }
  /* Validation des étoiles gagnées, puis note facultative dans le carnet */
  async function ecranValider() {
    const zone = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    pageP('Valider les étoiles', 'etoiles', badgeEtoiles(), zone);
    let l;
    try { l = await api('etoilesEnAttente'); } catch (e) { zone.replaceChildren(el('p', { class: 'vide', text: 'Indisponible hors ligne.' })); return; }
    if (!l.length) { D.attente = 0; store.set('donnees', D); zone.replaceChildren(el('p', { class: 'vide', text: 'Rien à valider.' }), el('a', { class: 'btn plein large', href: '#/', text: 'Revenir à l\'accueil' })); return; }
    const cases = l.map(e => { const c = el('input', { type: 'checkbox', checked: true }); c.eid = e.id; return el('label', { class: 'case' }, c, el('span', {}, el('b', { text: '+' + e.delta + ' ★ ' }), e.motif, el('span', { class: 'muted petit', text: ' · ' + String(e.horodatage).slice(5, 16).replace('T', ' ') }))); });
    const note = formCarnet(null, 'Un mot pour le carnet ? (facultatif)', true);
    const go = el('button', { class: 'btn ok large', type: 'button', text: 'Valider et revenir à l\'accueil', onclick: async () => {
      go.disabled = true;
      const refuses = cases.filter(c => !c.querySelector('input').checked).map(c => String(c.querySelector('input').eid));
      try {
        const r = await api('validerEtoiles', { refuses }); D.etoiles = r.etoiles; D.attente = 0; store.set('donnees', D);
        const e = note.entree();
        if (e) { try { await api('ajouterCarnet', { entree: e }); } catch (er) { toast('Étoiles validées, mais la note n\'a pas pu être enregistrée.', true); } }
        toast('Étoiles validées : ' + D.etoiles + ' dans la tirelire.' + (e ? ' Note enregistrée.' : ''));
        /* Retour à l'accueil de Faël, espace parents refermé */
        parentOk = false; location.hash = '#/';
      } catch (er) { toast(er.message, true); go.disabled = false; }
    } });
    zone.replaceChildren(el('p', { class: 'muted petit', text: 'Décoche ce qui ne doit pas compter (par exemple une séance faite trop vite).' }), ...cases, note, go);
  }

  /* ---------- Mode parent pendant une séance (cadenas) ---------- */
  function modeParentSeance(c, q) {
    const v = voile('Mode parent');
    const menu = () => v.corps.replaceChildren(
      el('p', { class: 'muted petit', text: 'La séance de Faël reste ouverte derrière : rien n\'est perdu. Ce que vous modifiez ici compte dès la prochaine séance.' }),
      el('button', { class: 'btn plein large', type: 'button', text: '💡 Comment lui expliquer autrement ?', onclick: expliquer }),
      el('button', { class: 'btn large', type: 'button', text: '✏️ Modifier l\'exercice', onclick: () => ecranEditeur(c.id, null, { cible: v.corps, apres: () => { toast('Enregistré. La séance continue ; les changements comptent dès la prochaine.'); v.remove(); } }) }),
      el('button', { class: 'btn large', type: 'button', text: '💬 Donner un retour à l\'IA', onclick: () => v.corps.replaceChildren(encartDemande(c.id)) }),
      el('button', { class: 'btn discret large', type: 'button', text: '? Aide sur ce mode parent', onclick: () => v.corps.replaceChildren(blocAide('seance', true), el('button', { class: 'btn discret', type: 'button', text: '‹ Retour', onclick: menu })) }));
    function expliquer() {
      const diff = el('textarea', { style: 'min-height:70px' }); diff.value = q ? 'Question en cours : ' + q.enonce + (q.bonne ? ' (réponse : ' + q.bonne + ')' : '') : '';
      const res = el('div', { class: 'liste' });
      const go = el('button', { class: 'btn plein', type: 'button', text: 'Proposer 3 façons d\'expliquer', disabled: !D.mistral, onclick: async () => {
        go.disabled = true; res.replaceChildren(el('p', { class: 'muted petit', text: 'L\'IA réfléchit…' }));
        try {
          const r = await api('expliquerPourParents', { id: c.id, difficulte: diff.value.trim() });
          res.replaceChildren(...r.approches.map((a, k) => el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:6px' },
            el('b', { text: (k + 1) + '. ' + a.titre }), el('span', { text: a.comment || a.idee || '' }), a.exemple ? el('span', { class: 'aide' }, el('b', { text: 'À dire : ' }), a.exemple) : null)),
            r.piege ? el('p', { class: 'alerte', text: '⚠️ Piège fréquent : ' + r.piege }) : null);
        } catch (e) { res.replaceChildren(el('p', { class: 'muted petit', text: e.message })); }
        go.disabled = false;
      } });
      v.corps.replaceChildren(el('label', { class: 'champ' }, 'Ce qui coince (facultatif)', diff), go, res, el('button', { class: 'btn discret', type: 'button', text: '‹ Retour', onclick: menu }));
    }
    codeDansVoile(v, menu);
  }


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
  function ecranEditeur(id, typeNouveau, opts) {
    /* opts.cible : affichage dans une fenêtre par-dessus la séance ; opts.apres : suite après enregistrement */
    const rendu = opts && opts.cible ? (t, ...k) => opts.cible.replaceChildren(el('div', { class: 'editeur-voile' }, ...k)) : page;
    const c = id ? contenu(id) : (brouillon && brouillon.type === typeNouveau ? brouillon : { type: typeNouveau, matiere: 'Français', theme: '', titre: '', donnees: {}, statut: 'à valider', source: 'saisie directe' });
    if (!c) { rendu(tete('Exercice', '#/'), el('p', { class: 'vide', text: 'Introuvable.' })); return; }
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
    const donnees = () => Object.assign(lire(), { retiens: depuisTexte.retiens(retiens.value) }, d.defis ? { defis: d.defis } : {});
    const objet = statut => ({ id: c.id, type: ty, titre: titre.value.trim(), matiere: matiere.value, theme: theme.value.trim() || 'Divers', donnees: donnees(), statut, source: c.source || 'saisie directe' });
    async function sauver(statut, puis) {
      const o = objet(statut);
      if (!o.titre) return toast('Il manque le titre.', true);
      if (!questions(o).length) return toast('Le contenu est vide ou incomplet.', true);
      try { const r = await api('enregistrerContenu', { contenu: o }); brouillon = null; await charger(); toast('Enregistré : Faël peut le faire.'); puis ? puis(r) : opts && opts.apres ? opts.apres(r) : (location.hash = '#/p/contenu/' + r.id); }
      catch (e) { toast(e.message, true); }
    }
    rendu(tete(id ? 'Modifier' : 'Nouvel exercice', id ? '#/' : '#/p/exercices'),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('p', { class: 'muted petit', text: TYPES[ty] + ' · ' + (c.source || '') }),
        el('label', { class: 'champ' }, 'Titre', titre),
        el('div', { class: 'grille2' }, el('label', { class: 'champ' }, 'Matière', matiere), el('label', { class: 'champ' }, 'Thème', theme, dl)),
        corps,
        el('label', { class: 'champ' }, 'Je retiens (facultatif)', el('span', { class: 'aide-champ', text: 'Une carte par bloc : 1re ligne = titre, puis le texte, et « Ex : » pour un exemple.' }), retiens),
        c.texteLu ? el('details', { class: 'lu' }, el('summary', { text: 'Le texte de départ' }), el('pre', { text: c.texteLu })) : null),
      el('div', { class: 'rangee' },
        opts ? null : el('button', { class: 'btn', type: 'button', text: 'Essayer', onclick: () => sauver('validé', r => { location.hash = '#/essai/' + r.id; }) }),
        el('button', { class: 'btn plein', type: 'button', text: 'Enregistrer', onclick: () => sauver('validé') })),
      id ? blocVersions(c.id) : null,
      id && !opts ? el('a', { class: 'btn discret large', href: '#/p/retour/' + c.id, text: 'Donner un retour à l\'IA sur cet exercice' }) : null,
      id && !opts ? el('button', { class: 'btn discret large', type: 'button', text: 'Archiver (Faël ne le verra plus)', onclick: async () => {
        if (!confirm('Archiver cet exercice ?')) return;
        try { await api('statutContenu', { id: c.id, statut: 'archivé' }); await charger(); location.hash = '#/'; } catch (e) { toast(e.message, true); } } }) : null);
  }
  /* Chaque enregistrement garde la version précédente : on peut revenir en arrière */
  function blocVersions(id) {
    const zone = el('div', { class: 'liste' });
    const d = el('details', { class: 'carte' }, el('summary', { class: 'sommaire', text: '🕘 Versions précédentes' }), zone);
    d.addEventListener('toggle', async () => {
      if (!d.open) return; zone.replaceChildren(el('p', { class: 'muted petit', text: 'Chargement…' }));
      try {
        const l = await api('versions', { id });
        zone.replaceChildren(...(l.length ? l.map(v => el('div', { class: 'tuile' }, el('span', {}, el('span', { class: 't', text: v.titre }), el('span', { class: 's', text: String(v.horodatage).slice(0, 16).replace('T', ' ') + (v.source ? ' · ' + v.source : '') })),
          el('button', { class: 'btn discret', style: 'margin-left:auto', type: 'button', text: 'Restaurer', onclick: async () => { if (!confirm('Revenir à cette version ? La version actuelle sera gardée dans l\'historique.')) return; try { await api('restaurerVersion', { id, horodatage: v.horodatage }); await charger(); toast('Version restaurée.'); location.hash = '#/p/contenu/' + id; router(); } catch (e) { toast(e.message, true); } } })))
          : [el('p', { class: 'muted petit', text: 'Pas encore de version précédente.' })]));
      } catch (e) { zone.replaceChildren(el('p', { class: 'muted petit', text: 'Indisponible hors ligne.' })); }
    });
    return d;
  }
  /* OCR sur le téléphone (Tesseract, libre) : la photo ne quitte pas l'appareil */
  let tesseract = null;
  function chargerTesseract() {
    if (tesseract) return tesseract;
    tesseract = new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      sc.onload = () => ok(window.Tesseract); sc.onerror = () => { tesseract = null; ko(new Error('Lecture sur le téléphone indisponible (réseau ?).')); }; document.head.append(sc); });
    return tesseract;
  }
  async function lireSurTelephone(dataUrl, etat) {
    const T = await chargerTesseract();
    const w = await T.createWorker('fra', 1, { logger: m => { if (m.status === 'recognizing text') etat('Lecture… ' + Math.round(m.progress * 100) + ' %'); else etat('Préparation de la lecture…'); } });
    try { const r = await w.recognize(dataUrl); return r.data.text || ''; } finally { w.terminate(); }
  }

  function ecranGenerer() {
    const lien = prepa; prepa = null;
    const ia = D.mistral, nomIA = D.ia ? 'l\'IA (Mistral via ' + D.ia + ')' : 'l\'IA';
    const ty = el('select', {}, Object.keys(TYPES).map(t => el('option', { value: t, text: TYPES[t], selected: t === 'qcm' })));
    const texte = el('textarea', { placeholder: 'Tape ou colle ici la leçon, la liste de mots, l\'exercice… ou prends une photo : le texte s\'écrit ici tout seul.' });
    if (lien && lien.texte) texte.value = lien.texte;
    const precision = el('input', { placeholder: 'Ex. : seulement les mots en bleu ; 10 questions faciles' });
    const photo = el('input', { type: 'file', accept: 'image/*' });
    const apercu = el('div');
    let image = null, lecture = false;
    /* Lecture automatique de la photo : par l'IA si elle est activée, sinon sur le téléphone.
       Un petit repère discret à côté du champ texte dit qui a lu ; le téléphone sert de secours. */
    const repere = el('span', { class: 'repere-lecture', role: 'status', hidden: true });
    const secours = el('button', { class: 'btn-lien', type: 'button', hidden: true, text: 'Lire sur le téléphone à la place', onclick: () => lireLocal() });
    const marquer = (etat, txt) => { repere.hidden = false; repere.className = 'repere-lecture ' + etat; repere.textContent = txt; };
    const ajouter = t => { texte.value = (t.trim() + (texte.value.trim() ? '\n\n' + texte.value : '')).trim(); };
    async function lireLocal() {
      secours.hidden = true; lecture = true; go.disabled = true;
      try { ajouter(await lireSurTelephone('data:image/jpeg;base64,' + image.b64, m => marquer('cours', '📱 ' + m))); marquer('ok', '📱 Lu sur le téléphone · relis si besoin'); }
      catch (e) { marquer('ko', e.message); }
      lecture = false; go.disabled = !ia;
    }
    async function lireIA() {
      secours.hidden = true; lecture = true; go.disabled = true; marquer('cours', '✨ L\'IA lit la photo…');
      try { const r = await api('lirePhoto', { photoBase64: image.b64 }); ajouter(r.texte || ''); marquer('ok', '✨ Lu par l\'IA · relis si besoin'); }
      catch (e) { marquer('ko', '✨ L\'IA n\'a pas pu lire la photo.'); secours.hidden = false; }
      lecture = false; go.disabled = !ia;
    }
    photo.addEventListener('change', async () => { const f = photo.files && photo.files[0]; if (!f) return; image = await reduire(f);
      apercu.replaceChildren(el('img', { src: image.apercu, alt: '', style: 'max-width:160px;border-radius:8px' }));
      api('deposerPhoto', { base64: image.b64, commentaire: precision.value.trim() }).catch(() => {});
      ia ? lireIA() : lireLocal(); });
    const go = el('button', { class: 'btn plein large', type: 'button', text: 'Préparer l\'exercice avec l\'IA', disabled: !ia, onclick: async () => {
      if (lecture) return toast('Attends la fin de la lecture de la photo.', true);
      if (!texte.value.trim()) return toast('Il faut d\'abord un texte : tape-le ou prends une photo.', true);
      go.disabled = true; go.textContent = 'L\'IA prépare le brouillon…';
      try {
        const r = await api('genererContenu', { type: ty.value, texte: texte.value, precision: precision.value.trim() });
        const c = await api('enregistrerContenu', { contenu: { type: r.type, titre: r.titre || 'Exercice du ' + jour(), matiere: MATIERES.includes(r.matiere) ? r.matiere : 'Français', theme: r.theme || 'Divers', donnees: r.donnees, statut: 'validé', source: 'IA (' + (r.modele || 'Mistral') + ')' } });
        if (lien && lien.tache) {
          const t = lien.tache; t.contenu = c.id; (t.besoins || []).forEach(b => { if (/exercice/.test(b.libelle) || (image && /photo/.test(b.libelle))) b.fait = true; });
          try { await api('enregistrerTache', { tache: t }); } catch (e) { /* le lien se refera à la main */ }
          await charger(); toast('Prêt et relié à la tâche « ' + t.titre + ' ».'); location.hash = lien.retour || '#/p/semaine'; return;
        }
        await charger(); toast('Prêt : Faël peut le faire. Tu peux le relire ou l\'essayer.');
        location.hash = '#/p/contenu/' + c.id;
      } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Préparer l\'exercice avec l\'IA'; }
    } });
    page(tete(lien && lien.tache ? 'Exercice pour « ' + lien.tache.titre + ' »' : 'Photo ou texte', (lien && lien.retour) || '#/p/exercices'),
      ia ? null : el('p', { class: 'aide', text: 'L\'IA n\'est pas encore activée : ajoute la clé dans le moteur (voir la notice). La photo est lue sur le téléphone en attendant.' }),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('div', { class: 'champ' }, '1. Photo de la leçon (facultatif)', boutonsPhoto(photo)), apercu,
        el('label', { class: 'champ' }, el('span', { class: 'lib-lecture' }, '2. Le texte de la leçon', repere), texte, secours),
        el('label', { class: 'champ' }, '3. Type d\'exercice voulu', ty),
        el('label', { class: 'champ' }, 'Précision pour l\'IA (facultatif)', precision),
        el('p', { class: 'muted petit', text: 'Seul le texte de la leçon part vers ' + nomIA + ' : jamais le prénom de Faël ni le journal. L\'exercice est disponible tout de suite ; tu peux le corriger ou donner un retour ensuite.' })),
      go);
  }
  /* Deux boutons : l'appareil photo s'ouvre directement, ou on choisit une image déjà prise */
  function boutonsPhoto(galerie) {
    galerie.hidden = true;
    const cam = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    cam.addEventListener('change', () => { if (cam.files && cam.files[0]) { galerie.files = cam.files; galerie.dispatchEvent(new Event('change')); } });
    return el('div', { class: 'rangee' }, cam, galerie,
      el('button', { class: 'btn plein', type: 'button', text: '📷 Prendre une photo', onclick: () => cam.click() }),
      el('button', { class: 'btn', type: 'button', text: '🖼️ Choisir une image', onclick: () => galerie.click() }));
  }
  function reduire(fichier) {
    return new Promise((ok, ko) => { const img = new Image(), url = URL.createObjectURL(fichier);
      img.onload = () => { const m = 2000, r = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok({ b64: c.toDataURL('image/jpeg', 0.85).split(',')[1], apercu: c.toDataURL('image/jpeg', 0.4) }); };
      img.onerror = () => ko(new Error('Image illisible.')); img.src = url; });
  }
  /* Remise à zéro : confirmation dans le bouton lui-même (pas de fenêtre du navigateur, parfois bloquée dans l'appli installée) */
  function boutonRemiseAZero() {
    let arme = false, minuterie = null;
    const bt = el('button', { class: 'btn discret large', type: 'button', text: '↺ Remettre les étoiles à zéro', onclick: async () => {
      if (!arme) {
        arme = true; bt.classList.add('danger'); bt.textContent = 'Touche encore pour confirmer : tirelire à 0';
        minuterie = setTimeout(() => { arme = false; bt.classList.remove('danger'); bt.textContent = '↺ Remettre les étoiles à zéro'; }, 5000);
        return;
      }
      clearTimeout(minuterie); bt.disabled = true; bt.textContent = 'Remise à zéro…';
      try {
        await charger(); /* solde à jour avant de le ramener à 0 */
        /* Étoiles pas encore validées : effacées si le moteur le permet (v5 et plus) */
        try { const att = await api('etoilesEnAttente'); if (att.length) await api('validerEtoiles', { refuses: att.map(e => String(e.id)) }); } catch (e) { /* moteur plus ancien : rien en attente */ }
        const x = (D.etoiles || 0) ? await api('ajusterEtoiles', { delta: -(D.etoiles || 0), motif: 'remise à zéro par un parent' }) : { etoiles: 0 };
        D.etoiles = x.etoiles; D.attente = 0; store.set('donnees', D); toast('Étoiles remises à zéro.'); ecranEtoiles();
      } catch (e) { toast('Remise à zéro impossible : ' + e.message, true); bt.disabled = false; arme = false; bt.classList.remove('danger'); bt.textContent = '↺ Remettre les étoiles à zéro'; }
    } });
    return bt;
  }
  /* ---------- Étoiles et récompenses (parents) ---------- */
  const EMOJIS = ['🎁', '🎮', '📺', '🍦', '🍰', '🛝', '🚲', '⚽', '🎨', '📚', '🧸', '🎬', '🏊', '🌙'];
  const emojiDe = nom => { const m = String(nom || '').match(/^(\p{Extended_Pictographic}️?)\s*/u); return m ? m[1] : '🎁'; };
  const sansEmoji = nom => String(nom || '').replace(/^(\p{Extended_Pictographic}️?)\s*/u, '');
  const dateCourte = h => { const j = String(h || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(j) ? nomJour(j) + ' ' + MOIS[dateJ(j).getMonth()] : j; };
  function formRecompense(r, apres) {
    let emoji = r ? emojiDe(r.nom) : '🎁';
    const nom = el('input', { value: r ? sansEmoji(r.nom) : '', placeholder: 'Ex. : 15 minutes de jeu vidéo' });
    const cout = el('input', { type: 'number', min: 1, inputmode: 'numeric', value: r ? r.cout : 10 });
    const choixE = el('div', { class: 'emojis', role: 'radiogroup', 'aria-label': 'Image' }, EMOJIS.map(e => el('button', { type: 'button', 'aria-pressed': String(e === emoji), text: e, onclick: ev => { emoji = e; choixE.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent === e))); } })));
    return el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' },
      el('h2', { text: r ? 'Modifier la récompense' : 'Nouvelle récompense' }), choixE,
      el('div', { class: 'grille2' }, el('label', { class: 'champ' }, 'Récompense', nom), el('label', { class: 'champ' }, 'Prix en étoiles', cout)),
      el('p', { class: 'muted petit', text: 'Repère : une séance rapporte en général 5 à 12 étoiles. Une petite récompense vers 10, une grande vers 50.' }),
      el('div', { class: 'rangee' }, el('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => apres(false) }),
        el('button', { class: 'btn plein', type: 'button', text: 'Enregistrer', onclick: async () => {
          if (!nom.value.trim()) return nom.focus();
          try { await api('enregistrerRecompense', { recompense: { id: r && r.id, nom: emoji + ' ' + nom.value.trim(), cout: Number(cout.value), actif: 1 } }); await charger(); toast('Enregistré.'); apres(true); } catch (e) { toast(e.message, true); } } })));
  }
  async function ecranEtoiles() {
    const zone = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    pageP('Étoiles et récompenses', 'etoiles', badgeEtoiles(), zone);
    let st, toutes;
    try { [st, toutes] = await Promise.all([api('resumeEtoiles'), api('toutesRecompenses'), charger()]); }
    catch (e) { zone.replaceChildren(el('p', { class: 'vide', text: 'Indisponible hors ligne.' })); return; }
    D.etoiles = st.solde; D.attente = st.attente; store.set('donnees', D);
    const formZone = el('div');
    const donner = (libelle, args) => el('button', { class: 'btn plein', type: 'button', text: libelle, onclick: async ev => {
      const b = ev.currentTarget; b.disabled = true;
      try { await api('echangerRecompense', args); await charger(); toast('Récompense donnée !'); ecranEtoiles(); } catch (e) { toast(e.message, true); b.disabled = false; } } });
    const choix = (st.echanges || []).filter(e => e.statut === 'demandée');
    const obtenues = (st.echanges || []).filter(e => e.statut === 'donnée');
    const actives = toutes.filter(r => String(r.actif) !== '0').sort((a, b) => a.cout - b.cout), archivees = toutes.filter(r => String(r.actif) === '0');
    const max = Math.max(1, ...st.semaines.map(x => x.etoiles));
    zone.replaceChildren(...[
      /* Résumé */
      el('section', { class: 'carte resume-etoiles' },
        el('div', { class: 'gros-compteur' }, el('b', { text: '★ ' + st.solde }), el('span', { text: 'dans la tirelire' + (st.attente ? ' · +' + st.attente + ' à valider' : '') })),
        el('div', { class: 'chiffres' }, [['Aujourd\'hui', st.aujourdhui], ['7 jours', st.semaine], ['30 jours', st.mois], ['Gagnées en tout', st.total], ['Dépensées', st.depense]].map(([l, v]) => el('div', {}, el('b', { text: String(v) }), el('small', { text: l })))),
        el('div', { class: 'barres', 'aria-label': 'Étoiles gagnées par semaine' }, st.semaines.map((w, k) => el('div', { class: 'barre-sem', title: 'Semaine du ' + dateCourte(w.du) + ' : ' + w.etoiles + ' étoiles' },
          el('span', { class: 'v', text: w.etoiles ? String(w.etoiles) : '' }), el('i', { style: 'height:' + Math.round(4 + 70 * w.etoiles / max) + 'px' }), el('small', { text: k === st.semaines.length - 1 ? 'cette sem.' : '' })))),
        st.attente ? el('a', { class: 'btn ok', href: '#/p/valider', text: 'Valider les ' + st.attente + ' étoiles en attente' }) : null),
      /* Choix de Faël */
      choix.length ? el('section', { class: 'carte choix-fael' }, el('h2', { text: 'Faël a choisi' }),
        ...choix.map(c => el('div', { class: 'tuile' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: emojiDe(c.nom) }),
          el('span', {}, el('span', { class: 't', text: sansEmoji(c.nom) }), el('span', { class: 's', text: c.cout + ' ★ · le ' + dateCourte(c.horodatage) })),
          el('span', { class: 'rangee', style: 'margin-left:auto' }, donner('Donner', { demande: c.id }),
            el('button', { class: 'btn discret', type: 'button', text: 'Pas maintenant', onclick: async () => { try { await api('annulerChoix', { id: c.id }); await charger(); ecranEtoiles(); } catch (e) { toast(e.message, true); } } }))))) : null,
      /* Récompenses */
      el('h3', { text: 'Les récompenses' }),
      ...actives.map(r => el('div', { class: 'tuile recompense' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: emojiDe(r.nom) }),
        el('span', {}, el('span', { class: 't', text: sansEmoji(r.nom) }), el('span', { class: 's', text: r.cout + ' étoiles' + (st.solde >= r.cout ? ' · Faël peut l\'avoir' : ' · encore ' + (r.cout - st.solde)) })),
        el('span', { class: 'rangee', style: 'margin-left:auto' },
          st.solde >= Number(r.cout) ? donner('Donner', { id: r.id }) : null,
          el('button', { class: 'rond', type: 'button', 'aria-label': 'Modifier ' + r.nom, text: '✎', onclick: () => formZone.replaceChildren(formRecompense(r, () => ecranEtoiles())) }),
          el('button', { class: 'rond', type: 'button', 'aria-label': 'Retirer ' + r.nom, text: '🗑', onclick: async () => { try { await api('enregistrerRecompense', { recompense: { id: r.id, nom: r.nom, cout: r.cout, actif: 0 } }); await charger(); toast('Retirée (elle reste dans l\'historique).'); ecranEtoiles(); } catch (e) { toast(e.message, true); } } })))),
      actives.length ? null : el('p', { class: 'vide', text: 'Aucune récompense : ajoutez-en une.' }),
      el('button', { class: 'btn large', type: 'button', text: '➕ Ajouter une récompense', onclick: () => { formZone.replaceChildren(formRecompense(null, () => ecranEtoiles())); formZone.scrollIntoView({ behavior: 'smooth' }); } }),
      formZone,
      archivees.length ? el('details', { class: 'carte' }, el('summary', { class: 'sommaire', text: 'Récompenses retirées (' + archivees.length + ')' }),
        ...archivees.map(r => el('div', { class: 'tuile' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: emojiDe(r.nom) }), el('span', {}, el('span', { class: 't', text: sansEmoji(r.nom) }), el('span', { class: 's', text: r.cout + ' étoiles' })),
          el('button', { class: 'btn discret', style: 'margin-left:auto', type: 'button', text: 'Remettre', onclick: async () => { try { await api('enregistrerRecompense', { recompense: { id: r.id, nom: r.nom, cout: r.cout, actif: 1 } }); await charger(); ecranEtoiles(); } catch (e) { toast(e.message, true); } } })))) : null,
      /* Déjà obtenues */
      el('h3', { text: 'Récompenses déjà obtenues' }),
      obtenues.length ? el('div', { class: 'liste' }, obtenues.map(e => el('div', { class: 'tuile' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: emojiDe(e.nom) }),
        el('span', {}, el('span', { class: 't', text: sansEmoji(e.nom) }), el('span', { class: 's', text: '−' + e.cout + ' ★ · ' + dateCourte(e.modifie || e.horodatage) }))))) : el('p', { class: 'muted petit', text: 'Pas encore de récompense obtenue.' }),
      /* Outils */
      el('details', { class: 'carte' }, el('summary', { class: 'sommaire', text: 'Ajuster, remettre à zéro, historique détaillé' }),
        el('div', { style: 'display:flex;flex-direction:column;gap:12px;margin-top:10px' },
          el('p', { class: 'muted petit', text: 'Ajuster à la main' }),
          el('div', { class: 'rangee' }, [-5, -1, 1, 5].map(n => el('button', { class: 'btn discret', type: 'button', text: (n > 0 ? '+' : '') + n, onclick: async () => { try { const x = await api('ajusterEtoiles', { delta: n, motif: 'ajustement parent' }); D.etoiles = x.etoiles; store.set('donnees', D); ecranEtoiles(); } catch (e) { toast(e.message, true); } } }))),
          boutonRemiseAZero(),
          el('div', { class: 'liste', id: 'histo-etoiles' }, el('button', { class: 'btn discret', type: 'button', text: 'Voir l\'historique des étoiles', onclick: async ev => {
            const box = ev.currentTarget.parentNode;
            try { const h = await api('historiqueEtoiles'); box.replaceChildren(...(h.length ? h.slice(0, 60).map(x => el('p', { class: 'petit' }, el('b', { text: (Number(x.delta) > 0 ? '+' : '') + x.delta + ' ' }), x.motif, el('span', { class: 'muted', text: ' · ' + String(x.horodatage).slice(0, 16).replace('T', ' ') }))) : [el('p', { class: 'muted petit', text: 'Rien pour l\'instant.' })])); }
            catch (e) { toast('Historique indisponible hors ligne.', true); } } }))))].filter(Boolean));
  }

  /* ---------- Ma tirelire (Faël) ---------- */
  function carteTirelire() {
    const n = D.etoiles || 0, rec = (D.recompenses || []).slice().sort((a, b) => a.cout - b.cout);
    const prochaine = rec.find(r => Number(r.cout) > n) || null, possible = rec.filter(r => Number(r.cout) <= n).pop();
    const choisie = (D.choix || [])[0];
    const cible = prochaine || possible;
    return el('a', { class: 'tirelire', href: '#/tirelire', 'aria-label': 'Ma tirelire : ' + n + ' étoiles' },
      el('div', { class: 'tirelire-haut' }, el('span', { class: 'tirelire-n' }, el('b', { text: '★' }), ' ' + n), D.attente ? el('span', { class: 'tirelire-att', text: '+' + D.attente + ' à faire valider' }) : null, el('span', { class: 'fl', text: '›' })),
      choisie ? el('span', { class: 'tirelire-txt', text: 'Tu as choisi : ' + sansEmoji(choisie.nom) + ' ' + emojiDe(choisie.nom) + '. Papa ou maman va te la donner !' })
        : cible ? [el('span', { class: 'tirelire-txt' }, possible && !prochaine ? 'Tu peux avoir : ' : prochaine && possible ? 'Tu peux déjà avoir « ' + sansEmoji(possible.nom) + ' ». Prochaine : ' : 'Prochaine récompense : ', el('b', { text: sansEmoji(cible.nom) + ' ' + emojiDe(cible.nom) }), prochaine ? ' — encore ' + (prochaine.cout - n) + ' ★' : ''),
          el('span', { class: 'jauge', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.min(100, Math.round(100 * n / Math.max(1, cible.cout))) + '%' }))]
        : el('span', { class: 'tirelire-txt', text: 'Gagne des étoiles en faisant tes exercices !' }));
  }
  async function ecranTirelire() {
    const n = D.etoiles || 0, rec = (D.recompenses || []).slice().sort((a, b) => a.cout - b.cout);
    const choisies = (D.choix || []).map(c => String(c.recompense));
    const gagnees = el('div', { class: 'liste' }), stats = el('p', { class: 'muted' });
    page(tete('Ma tirelire', '#/', badgeEtoiles()),
      el('section', { class: 'carte bilan' }, el('span', { class: 'gros', text: '★ ' + n }), el('p', { text: n ? 'Bravo, ce sont tes étoiles !' : 'Ta tirelire attend tes premières étoiles.' }),
        D.attente ? el('p', { class: 'muted petit', text: '+' + D.attente + ' étoiles attendent que papa ou maman les valide (« J\'ai fini ! »).' }) : null, stats),
      el('h3', { text: 'Les récompenses' }),
      el('div', { class: 'liste' }, rec.length ? rec.map(r => {
        const ok = n >= Number(r.cout), deja = choisies.includes(String(r.id));
        return el('div', { class: 'tuile recompense' + (ok ? ' possible' : '') }, el('span', { class: 'ic grand-ic', 'aria-hidden': 'true', text: emojiDe(r.nom) }),
          el('span', { style: 'flex:1 1 150px;min-width:0' }, el('span', { class: 't', text: sansEmoji(r.nom) }),
            el('span', { class: 'jauge', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.min(100, Math.round(100 * n / Math.max(1, r.cout))) + '%' })),
            el('span', { class: 's', text: deja ? 'Choisie ! Papa ou maman va te la donner.' : ok ? r.cout + ' ★ : tu peux l\'avoir !' : n + ' / ' + r.cout + ' ★ · encore ' + (r.cout - n) })),
          ok && !deja ? el('button', { class: 'btn plein', type: 'button', text: 'Je la choisis !', onclick: async ev => {
            const b = ev.currentTarget; b.disabled = true;
            try { await api('choisirRecompense', { id: r.id }); await charger(); toast('Super choix ! Montre-le à papa ou maman.'); dire([{ texte: 'Super choix ! Papa ou maman va te donner ta récompense.' }]); ecranTirelire(); } catch (e) { toast(e.message, true); b.disabled = false; } } }) : null);
      }) : el('p', { class: 'vide', text: 'Papa ou maman va bientôt ajouter des récompenses.' })),
      el('h3', { text: 'Ce que j\'ai déjà gagné' }), gagnees);
    try {
      const st = await api('resumeEtoiles');
      stats.textContent = 'Cette semaine, tu as gagné ' + st.semaine + ' étoile' + (st.semaine > 1 ? 's' : '') + '. Depuis le début : ' + st.total + ' !';
      const ob = (st.echanges || []).filter(e => e.statut === 'donnée');
      gagnees.replaceChildren(...(ob.length ? ob.map(e => el('div', { class: 'tuile' }, el('span', { class: 'ic grand-ic', 'aria-hidden': 'true', text: emojiDe(e.nom) }), el('span', {}, el('span', { class: 't', text: sansEmoji(e.nom) }), el('span', { class: 's', text: dateCourte(e.modifie || e.horodatage) })))) : [el('p', { class: 'muted petit', text: 'Pas encore : continue, tu y es presque !' })]));
    } catch (e) { gagnees.replaceChildren(el('p', { class: 'muted petit', text: 'Indisponible hors ligne.' })); }
  }

  /* Conseils : l'essentiel, l'approfondi, la mise en œuvre dans l'appli (avec contrôle), et une discussion avec l'IA */
  let ongletConseils = 'discuter', cacheConseils = null;
  async function ecranConseils(onglet) {
    if (onglet) ongletConseils = onglet;
    const zone = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement…' }));
    const ONG = [['discuter', 'Discuter'], ['essentiel', 'L\'essentiel'], ['approfondi', 'Approfondir'], ['appli', 'Dans l\'appli']];
    const chips = el('div', { class: 'chips', style: 'flex-wrap:wrap;overflow:visible' }, ONG.map(([k, lib]) => el('button', { type: 'button', 'aria-pressed': String(k === ongletConseils), text: lib, onclick: () => ecranConseils(k) })));
    pageP('Conseils', 'conseils', null, chips, zone);
    try {
      if (!cacheConseils) cacheConseils = await api('conseils');
      const c = cacheConseils;
      if (ongletConseils === 'essentiel') zone.replaceChildren(...c.essentiel.map(s => el('section', { class: 'carte' }, el('h2', { text: s.titre }), el('ul', {}, s.points.map(p => el('li', { text: p }))))),
        el('p', { class: 'muted petit', text: 'Pour aller plus loin : onglet « Approfondir ». Recherches vérifiées le ' + c.maj + '.' }));
      else if (ongletConseils === 'approfondi') zone.replaceChildren(
        el('p', { class: 'muted petit', text: 'Synthèse des recommandations de la HAS (2024) et des méta-analyses récentes, avec les tailles d\'effet. Recherches vérifiées le ' + c.maj + '. Le document de recherche dans Claude contient tous les liens.' }),
        ...c.approfondi.map(s => el('details', { class: 'carte', open: s === c.approfondi[0] }, el('summary', { style: 'cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center', text: s.titre }),
          s.texte ? el('p', { style: 'margin:8px 0', text: s.texte }) : null, el('ul', {}, s.points.map(p => el('li', { style: 'margin:6px 0', text: p }))))));
      else if (ongletConseils === 'appli') await ongletAppli(c, zone);
      else ongletDiscuter(zone);
    } catch (e) { zone.replaceChildren(el('p', { class: 'vide', text: 'Indisponible hors ligne.' })); }
  }

  async function ongletAppli(c, zone) {
    const controle = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Calcul du contrôle…' }));
    zone.replaceChildren(
      el('section', { class: 'carte' }, el('h2', { text: 'Contrôle automatique' }), el('p', { class: 'muted petit', text: 'Recalculé à chaque ouverture, à partir des réglages et des résultats réels des 14 derniers jours. Les seuils sont des repères de pratique, pas des normes scientifiques.' }), controle),
      el('p', { text: c.appli.intro }),
      ...c.appli.principes.map(p => el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:6px' },
        el('b', { text: p.principe }), el('span', {}, el('span', { class: 'badge', text: 'Dans l\'appli' }), ' ', p.application), el('span', { class: 'muted petit' }, el('b', { text: 'Garantie : ' }), p.garantie))),
      el('section', { class: 'carte' }, el('h2', { text: 'Comment c\'est assuré dans la durée' }), el('ul', {}, c.appli.assurance.map(p => el('li', { style: 'margin:6px 0', text: p })))));
    const r = R(), lignes = [];
    const ligne = (ok, titre, detail) => lignes.push(el('div', { class: 'tuile', style: 'align-items:flex-start' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: ok === true ? '🟢' : ok === false ? '🟠' : '⚪' }), el('span', {}, el('span', { class: 't', text: titre }), el('span', { class: 's', text: detail }))));
    ligne(r.taille <= 5, 'Séries courtes', r.taille + ' questions par série, ' + r.series + ' série' + (r.series > 1 ? 's' : '') + (r.taille > 5 ? ' : au-delà de 5, pensez à vérifier qu\'il tient jusqu\'au bout.' : '.'));
    ligne(!!r.pauses || r.series === 1, 'Pauses qui bougent', r.pauses ? 'Activées, ' + r.dureePause + ' s.' : 'Désactivées.');
    ligne(!!r.voix, 'Consignes lues à voix haute', r.voix ? 'Activées.' : 'Désactivées : la mémoire de travail est davantage sollicitée.');
    const exos = contenus(), sansLecon = exos.filter(x => !((x.donnees || {}).retiens || []).length).length;
    ligne(sansLecon === 0 ? true : sansLecon < exos.length / 2 ? null : false, 'Leçons « Je retiens »', exos.length - sansLecon + ' exercice' + (exos.length - sansLecon > 1 ? 's' : '') + ' sur ' + exos.length + ' ont une leçon en cartes.');
    try {
      const s = await api('statistiques');
      if (!s.premiersEssais) ligne(null, 'Résultats', 'Pas encore assez de séances sur 14 jours pour en tirer quelque chose.');
      else {
        ligne(s.reussitePremier >= 60 && s.reussitePremier <= 90, 'Niveau de difficulté', s.reussitePremier + ' % de bonnes réponses du premier coup sur ' + s.premiersEssais + ' questions' + (s.reussitePremier < 60 ? ' : peut-être trop difficile, donnez un retour sur les exercices concernés.' : s.reussitePremier > 90 ? ' : peut-être trop facile.' : ' : zone d\'entraînement confortable.') + (s.rattrapees ? ' ' + s.rattrapees + ' rattrapées au deuxième essai.' : ''));
        if (s.dureeMediane != null) ligne(s.dureeMediane <= 40, 'Temps par question', 'Médiane ' + s.dureeMediane + ' s' + (s.dureeMediane > 40 ? ' : consignes peut-être trop longues ou décrochages.' : '.'));
        ligne(s.joursActifs >= 4, 'Régularité', s.seances + ' séance' + (s.seances > 1 ? 's' : '') + ' sur ' + s.joursActifs + ' jour' + (s.joursActifs > 1 ? 's' : '') + ' en 14 jours.');
      }
    } catch (e) { ligne(null, 'Résultats', 'Indisponibles hors ligne.'); }
    controle.replaceChildren(...lignes);
  }

  async function ongletDiscuter(zone, espace) {
    const fil = el('div', { class: 'liste' }, el('p', { class: 'muted petit', text: 'Chargement de la discussion…' }));
    const ta = el('textarea', { style: 'min-height:90px', placeholder: espace === 'carnet' ? 'Ex. : la concentration baisse depuis trois jours, qu\'est-ce qu\'on peut ajuster ? Que retenir de la semaine ?' : 'Ex. : comment présenter le système d\'étoiles sans qu\'il devienne du chantage ? Que dit la recherche sur les devoirs le soir ?' });
    const web = el('input', { type: 'checkbox', disabled: D.ia !== 'Mammouth' });
    const bulle = m => el('div', { class: 'retour ' + (m.role === 'parent' ? 'info' : 'ok'), style: m.role === 'parent' ? 'margin-left:24px' : 'margin-right:12px' },
      el('b', { class: 'petit', text: m.role === 'parent' ? 'Vous' : 'IA' + (m.modele ? ' · ' + m.modele : '') }), el('span', { style: 'white-space:pre-wrap', text: m.texte }),
      m.sources ? el('span', { class: 'petit' }, 'Sources : ', String(m.sources).split('\n').filter(Boolean).map((u, k) => [k ? ' · ' : '', el('a', { href: u, target: '_blank', rel: 'noopener', text: (u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]) })])) : null);
    const go = el('button', { class: 'btn plein', type: 'button', text: 'Envoyer', disabled: !D.mistral, onclick: async () => {
      const q = ta.value.trim(); if (!q) return ta.focus();
      go.disabled = true; go.textContent = web.checked ? 'Recherche sur le web…' : 'Réflexion…';
      fil.append(bulle({ role: 'parent', texte: q }));
      try { const r = await api('discuter', { message: q, web: web.checked, espace }); ta.value = ''; fil.append(bulle({ role: 'ia', texte: r.texte, sources: r.sources, modele: r.modele })); fil.lastChild.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (e) { toast(e.message, true); fil.lastChild.remove(); }
      go.disabled = false; go.textContent = 'Envoyer';
    } });
    zone.replaceChildren(
      espace === 'carnet' ? null : el('p', { class: 'muted petit', text: 'L\'IA répond à partir de la base de connaissances de cet onglet (recherches vérifiées). Cochez « recherche web » pour qu\'elle cherche aussi en direct : la question part alors vers Perplexity (Sonar, via Mammouth), un service américain.' }),
      fil,
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' }, ta,
        el('label', { style: 'display:flex;gap:10px;align-items:center;min-height:44px' }, web, D.ia === 'Mammouth' ? 'Chercher aussi sur le web (sources citées)' : 'Recherche web : disponible avec Mammouth'),
        go,
        el('button', { class: 'btn discret', type: 'button', text: 'Nouvelle discussion', onclick: async () => { try { await api('nouveauFil', { espace }); ongletDiscuter(zone, espace); } catch (e) { toast(e.message, true); } } })));
    if (!D.mistral) fil.replaceChildren(el('p', { class: 'vide', text: 'L\'IA n\'est pas encore activée.' }));
    try { const d = await api('discussion', { espace }); fil.replaceChildren(...(d.messages.length ? d.messages.map(bulle) : [el('p', { class: 'vide', text: 'Posez votre première question.' })])); }
    catch (e) { fil.replaceChildren(el('p', { class: 'vide', text: 'Discussion indisponible hors ligne.' })); }
  }
  function ecranReglages() {
    const r = R();
    const sel = (lib, vals, v, fmt) => { const s = el('select', {}, vals.map(x => el('option', { value: x, text: fmt ? fmt(x) : x, selected: String(x) === String(v) }))); return [el('label', { class: 'champ' }, lib, s), s]; };
    const [lT, sT] = sel('Questions par série', [3, 5, 8, 10], r.taille), [lS, sS] = sel('Nombre de séries', [1, 2, 3], r.series);
    const [lP, sP] = sel('Pause qui bouge entre les séries', ['oui', 'non'], r.pauses ? 'oui' : 'non'), [lD, sD] = sel('Durée de la pause', [30, 45, 60], r.dureePause, x => x + ' secondes');
    const [lV, sV] = sel('Lecture à voix haute', ['oui', 'non'], r.voix ? 'oui' : 'non'), [lC, sC] = sel('Mode calme (moins de décor)', ['oui', 'non'], r.calme ? 'oui' : 'non');
    const code = el('input', { type: 'password', inputmode: 'numeric', value: r.codeParents || '', placeholder: 'Aucun', autocomplete: 'off' });
    const resultatTest = el('div', { class: 'petit' });
    pageP('Réglages', 'reglages', null,
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:12px' },
        el('h2', { text: 'Mode concentration' }), el('div', { class: 'grille2' }, lT, lS), el('div', { class: 'grille2' }, lP, lD), el('div', { class: 'grille2' }, lV, lC),
        el('label', { class: 'champ' }, 'Code parents', el('span', { class: 'aide-champ', text: 'Pour que Faël n\'entre pas dans l\'espace parents. Vide = pas de code.' }), code)),
      el('section', { class: 'carte', style: 'display:flex;flex-direction:column;gap:10px' },
        el('h2', { text: 'Intelligence artificielle' }),
        el('p', { text: D.mistral ? 'Fournisseur : ' + D.ia + '. Modèles autorisés : Mistral Small, puis Mistral Medium en secours, automatiquement.' : 'Pas encore de clé dans le moteur.' }),
        resultatTest,
        el('button', { class: 'btn', type: 'button', text: 'Tester les capacités', onclick: async ev => { const bt = ev.currentTarget; bt.disabled = true; resultatTest.textContent = 'Test en cours (10 à 20 secondes)…';
          try { const r = await api('testerCapacites'); resultatTest.replaceChildren(el('p', {}, el('b', { text: 'Texte : ' }), r.texte || '—'), el('p', {}, el('b', { text: 'Lecture de photo : ' }), r.vision || '—'), el('p', {}, el('b', { text: 'OCR Mistral direct : ' }), r.ocrMistral ? 'oui' : 'non (facultatif)'), r.credits ? el('p', { class: 'muted petit', text: (() => { try { const k = JSON.parse(r.credits); const i = k.info || k; const dep = Number(i.spend != null ? i.spend : k.spend); return isNaN(dep) ? 'Compte relié.' : 'Dépensé avec cette clé : ' + dep.toFixed(4) + ' $' + (i.max_budget ? ' sur un plafond de ' + i.max_budget + ' $' : ''); } catch (e) { return 'Compte relié.'; } })() }) : null); }
          catch (e) { resultatTest.textContent = e.message; } bt.disabled = false; } })),
      el('button', { class: 'btn plein large', type: 'button', text: 'Enregistrer', onclick: async () => {
        try { D.reglages = await api('enregistrerReglages', { reglages: { taille: Number(sT.value), series: Number(sS.value), pauses: sP.value === 'oui', dureePause: Number(sD.value), voix: sV.value === 'oui', calme: sC.value === 'oui', codeParents: code.value.trim() } }); store.set('donnees', D); toast('Enregistré.'); }
        catch (e) { toast(e.message, true); } } }),
      el('h3', { text: 'Aide' }),
      el('div', { class: 'liste' },
        el('a', { class: 'tuile', href: '#/p/aide' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '❓' }), el('span', {}, el('span', { class: 't', text: 'Toutes les explications' }), el('span', { class: 's', text: 'À quoi sert chaque section, comment elle marche' })), el('span', { class: 'fl', text: '›' })),
        el('button', { class: 'tuile', type: 'button', onclick: () => lancerVisite(0) }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '🧭' }), el('span', {}, el('span', { class: 't', text: 'Relancer la visite guidée' }), el('span', { class: 's', text: 'Découvrir tout l\'espace parents en 8 étapes' })), el('span', { class: 'fl', text: '›' }))),
      el('h3', { text: 'Moteur et suivi' }),
      el('div', { class: 'liste' },
        el('a', { class: 'tuile', href: '#/p/demandes' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '📨' }), el('span', {}, el('span', { class: 't', text: 'Demandes et retours' }), el('span', { class: 's', text: 'Ce que vous avez demandé à l\'IA, annulable' })), el('span', { class: 'fl', text: '›' })),
        el('a', { class: 'tuile', href: '#/relier' }, el('span', { class: 'ic', 'aria-hidden': 'true', text: '🔗' }), el('span', {}, el('span', { class: 't', text: 'Relier l\'appli au moteur' }), el('span', { class: 's', text: 'Une fois par appareil · ' + (D.mistral ? 'IA activée (' + D.ia + ')' : 'IA pas encore activée') })), el('span', { class: 'fl', text: '›' }))));
  }

  /* ---------- Routage ---------- */
  async function router() {
    const h = location.hash.replace(/^#\/?/, ''), [a, b, c] = h.split('/');
    document.querySelectorAll('.voile').forEach(v => v.remove());
    /* On quitte la visite guidée si on va ailleurs que l'étape en cours */
    document.querySelectorAll('.visite').forEach(v => { if (v.dataset.route !== (location.hash || '#/')) { v.remove(); document.body.classList.remove('en-visite'); } });
    if (a === 'relier' || !store.get('cfg', null)) return ecranRelier();
    if (!D) { app().replaceChildren(el('p', { class: 'vide', text: 'Chargement…' })); try { await charger(); } catch (e) { toast(e.message, true); return ecranRelier(); } }
    if (!a) return ecranAccueil();
    if (a === 'seance') return ecranSeance(b, false);
    if (a === 'tache') return ecranTache(b);
    if (a === 'fini') return ecranFini();
    if (a === 'tirelire') return ecranTirelire();
    if (a === 'parents') return porteParents(() => { ecranSemaine(); if (!store.get('visiteFaite', false)) setTimeout(() => lancerVisite(0), 500); });
    if (a === 'essai') return porteParents(() => ecranSeance(b, true));
    if (a === 'p') return porteParents(() => {
      if (b === 'aide') return ecranAide();
      if (b === 'semaine') return ecranSemaine(c);
      if (b === 'exercices' || b === 'ajouter') return ecranExercices();
      if (b === 'retour') return ecranExercices(c);
      if (b === 'nouveau') return TYPES[c] ? ecranEditeur(null, c) : ecranExercices();
      if (b === 'contenu') return ecranEditeur(c);
      if (b === 'generer') return ecranGenerer();
      if (b === 'carnet') return ecranCarnet(c);
      if (b === 'valider') return ecranValider();
      if (b === 'etoiles') return ecranEtoiles();
      if (b === 'conseils') return ecranConseils(c);
      if (b === 'reglages') return ecranReglages();
      if (b === 'demandes') return ecranDemandes();
      return ecranSemaine();
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
  window.__cf = { questions, variantes, depuisTexte, versTexte, prochainJourEcole, lundiDe };
})();

