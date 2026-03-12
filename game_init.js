// ══════════════════════════════════════════════════
// PATF TCG — Engine de Batalha (Servidor)
// Parte 1b: Inicializacao do Estado de Jogo
// ══════════════════════════════════════════════════

var gameData = require('./game_data.js');

// ── Baralho ─────────────────────────────────
// Mesmo baralho do cliente: 52 cartas + 2 coringas
function buildDeck() {
  var suits = ['hearts','spades','diamonds','clubs'];
  var vals = [
    {val:'A',nv:1},{val:'2',nv:2},{val:'3',nv:3},{val:'4',nv:4},
    {val:'5',nv:5},{val:'6',nv:6},{val:'7',nv:7},{val:'8',nv:8},
    {val:'9',nv:9},{val:'10',nv:10},{val:'J',nv:11},{val:'Q',nv:12},{val:'K',nv:13}
  ];
  var deck = [];
  for (var s = 0; s < suits.length; s++) {
    for (var v = 0; v < vals.length; v++) {
      deck.push({ suit: suits[s], val: vals[v].val, nv: vals[v].nv });
    }
  }
  deck.push({ suit:'joker', val:'JK', nv:0 });
  deck.push({ suit:'joker', val:'JK', nv:0 });
  // Embaralha
  for (var i = deck.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }
  return deck;
}

// ── Criar personagem de batalha ─────────────
function makeChar(data, owner) {
  return {
    id: data.id,
    name: data.name,
    suit: data.suit,
    atq: data.atq,
    def: data.def,
    inc: data.inc,
    pvs: data.pvs,
    owner: owner,
    hp: data.pvs,
    maxHp: data.pvs,
    curAtq: data.atq,
    curDef: data.def,
    alive: true,
    statuses: [],
    cooldowns: {},
    passiveBonuses: {},
    firstTurn: true,
    quickAction: false,
    extraTurnUsed: false,
    skills: data.skills.map(function(sk) {
      return {
        id: sk.id,
        name: sk.name,
        power: sk.power,
        type: sk.type,
        target: sk.target,
        desc: sk.desc || '',
        acao: sk.acao || 'N',
        recarga: sk.recarga || 'N',
        turno: sk.turno || 'N',
        recharge: sk.recharge || false
      };
    })
  };
}

// ── Inicializar estado de batalha ───────────
function initBattle(p1Ids, p2Ids) {
  var p1Chars = p1Ids.map(function(id) {
    var data = gameData.getCharById(id);
    return data ? makeChar(data, 'p1') : null;
  }).filter(Boolean);

  var p2Chars = p2Ids.map(function(id) {
    var data = gameData.getCharById(id);
    return data ? makeChar(data, 'p2') : null;
  }).filter(Boolean);

  if (p1Chars.length < 3 || p2Chars.length < 3) {
    return { error: 'Times incompletos' };
  }

  var state = {
    turn: 1,
    phase: 'initiative',
    p1: {
      chars: p1Chars,
      deck: buildDeck(),
      hand: [],
      discard: []
    },
    p2: {
      chars: p2Chars,
      deck: buildDeck(),
      hand: [],
      discard: []
    },
    order: [],
    orderIdx: 0,
    over: false,
    winner: null,
    log: []
  };

  // Compra inicial: 10 cartas cada
  for (var i = 0; i < 10; i++) {
    draw(state, 'p1');
    draw(state, 'p2');
  }

  return state;
}

// ── Comprar carta ───────────────────────────
function draw(state, pl, n) {
  if (!n) n = 1;
  var p = state[pl];
  for (var i = 0; i < n; i++) {
    if (!p.deck.length) return;
    if (p.hand.length >= 10) return;
    p.hand.push(p.deck.shift());
  }
}

// ── Descartar carta ─────────────────────────
function discard(state, pl, idx) {
  var p = state[pl];
  var card = p.hand.splice(idx, 1)[0];
  if (card) p.discard.push(card);
  return card;
}

// ── Verificar vitoria ───────────────────────
function checkWin(state) {
  var p1Alive = state.p1.chars.some(function(c) { return c.alive; });
  var p2Alive = state.p2.chars.some(function(c) { return c.alive; });
  var p1Cards = state.p1.deck.length + state.p1.hand.length;
  var p2Cards = state.p2.deck.length + state.p2.hand.length;

  if (!p1Alive || p1Cards === 0) {
    state.over = true;
    state.winner = 'p2';
    return 'p2';
  }
  if (!p2Alive || p2Cards === 0) {
    state.over = true;
    state.winner = 'p1';
    return 'p1';
  }
  return null;
}

// ── Resolver ataque ─────────────────────────
function resolveAttack(atq, poder, def) {
  var dano = atq + poder - def;
  return dano < 0 ? 0 : dano;
}
// ── DoTs (Dano por Turno) ───────────────────
// Chamado pelo servidor no inicio de cada turno natural
// Retorna array de efeitos que aconteceram (pro cliente exibir)
function applyDoTs(char) {
  var effects = [];

  for (var i = 0; i < char.statuses.length; i++) {
    var s = char.statuses[i];

    // ── QUEIMADURA ──
    if (s.id === 'burn') {
      var burnDmg = 10;
      char.hp -= burnDmg;
      char.curDef = Math.max(0, char.curDef - 1);
      effects.push({ id: 'burn', dmg: burnDmg, defLost: 1, icon: '🔥' });
    }

    // ── SANGRAMENTO ──
    if (s.id === 'bleed') {
      var bleedDmg = 3 * (s.stacks || 1);
      char.hp -= bleedDmg;
      effects.push({ id: 'bleed', dmg: bleedDmg, stacks: s.stacks || 1, icon: '🩸' });
    }

    // ── RADIAÇÃO ──
    if (s.id === 'rad') {
      var radDmg = 4 * (s.stacks || 1);
      char.hp -= radDmg;
      effects.push({ id: 'rad', dmg: radDmg, stacks: s.stacks || 1, icon: '☢️' });
    }

    // ── ESTÁTICA ──
    if (s.id === 'static') {
      var staticDmg = 5;
      char.hp -= staticDmg;
      effects.push({ id: 'static', dmg: staticDmg, icon: '⚡' });
    }

    // ── RESFRIAMENTO ──
    if (s.id === 'chill') {
      var chillDmg = 10;
      char.hp -= chillDmg;
      char.curAtq = Math.max(0, char.curAtq - 1);
      effects.push({ id: 'chill', dmg: chillDmg, atqLost: 1, icon: '🧊' });
    }
  }

  // Checa se morreu
  if (char.hp <= 0) {
    char.hp = 0;
    char.alive = false;
    effects.push({ type: 'death', charId: char.id });
  }

  return effects;
}
// ── Adicionar status (com stack) ────────────
function addStatus(ch, st) {
  var existing = ch.statuses.find(function(s) { return s.id === st.id; });
  if (existing) {
    existing.turns = st.turns;
    if (st.stacks && st.stackMax) {
      existing.stacks = Math.min((existing.stacks || 1) + 1, st.stackMax);
    }
  } else {
    ch.statuses.push({
      id: st.id,
      icon: st.icon,
      label: st.label,
      turns: st.turns,
      stacks: st.stacks || 0,
      stackMax: st.stackMax || 0
    });
  }
}

// ── Aplicar status de skill no alvo ─────────
function applySkillEffects(skill, target) {
  var d = skill.desc.toLowerCase();
  var applied = [];

  if (d.includes('queimadura')) {
    addStatus(target, {id:'burn', icon:'🔥', label:'Queimadura', turns:2});
    applied.push('burn');
  }

  if (d.includes('sangramento')) {
    addStatus(target, {id:'bleed', icon:'🩸', label:'Sangramento', turns:2, stacks:1, stackMax:3});
    applied.push('bleed');
  }

  if (d.includes('radia')) {
    addStatus(target, {id:'rad', icon:'☢️', label:'Radiação', turns:2, stacks:1, stackMax:4});
    applied.push('rad');
  }

  if (d.includes('estatica') || d.includes('estática')) {
    addStatus(target, {id:'static', icon:'⚡', label:'Estática', turns:2});
    applied.push('static');
  }

  if (d.includes('resfriamento')) {
    addStatus(target, {id:'chill', icon:'🧊', label:'Resfriamento', turns:2});
    applied.push('chill');
  }

  if (d.includes('congela')) {
    addStatus(target, {id:'frozen', icon:'❄️', label:'Congelado', turns:2});
    applied.push('frozen');
  }

  if (d.includes('atordoa')) {
    addStatus(target, {id:'stun', icon:'💫', label:'Atordoado', turns:2});
    applied.push('stun');
  }

  if (d.includes('exposto')) {
    target.curDef = Math.floor(target.def / 2);
    addStatus(target, {id:'exposed', icon:'⬇️', label:'Exposto', turns:2});
    applied.push('exposed');
  }

  if (d.includes('enfraquecido')) {
    target.curAtq = Math.floor(target.atq / 2);
    addStatus(target, {id:'weak', icon:'💢', label:'Enfraquecido', turns:2});
    applied.push('weak');
  }

  if (d.includes('amaciado')) {
    addStatus(target, {id:'amaciado', icon:'🥩', label:'Amaciado', turns:2});
    applied.push('amaciado');
  }

  if (d.includes('derreter')) {
    addStatus(target, {id:'melt', icon:'🧪', label:'Armadura Derretida', turns:1});
    applied.push('melt');
  }

  if (d.includes('lento')) {
    addStatus(target, {id:'slow', icon:'🐢', label:'Lento', turns:2});
    applied.push('slow');
  }

  if (d.includes('encantado')) {
    addStatus(target, {id:'encantado', icon:'🎭', label:'Encantado', turns:1});
    applied.push('encantado');
  }

  return applied;
                       }

module.exports = {
  buildDeck: buildDeck,
  makeChar: makeChar,
  initBattle: initBattle,
  draw: draw,
  discard: discard,
  checkWin: checkWin,
  resolveAttack: resolveAttack,
  applyDoTs: applyDoTs,
   applySkillEffects: applySkillEffects
};
