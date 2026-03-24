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
    _charge: 0,
    _linkAccum: 0,
    _satsui: 0,
    _chamadoTurno: 0,
    skills: data.skills.map(function(sk) {
      return {
        id: sk.id,
        name: sk.name,
        power: sk.power,
        type: sk.type,
        target: sk.target,
        desc: sk.desc || '',
        acao: sk.acao || 'N',
        recarga: sk.recarga || (sk.recharge ? 'L' : 'N'),
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

  applyStartPassives(state);
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
  // Decrementa turnos e remove status expirados
  char.statuses = char.statuses.filter(function(s) {
    s.turns = (s.turns || 1) - 1;
    return s.turns > 0;
  });

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
function applySkillEffects(skill, target, attacker) {
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

  if (d.includes('fortalecido')) {
    target.curAtq = Math.floor(target.curAtq * 1.5);
    addStatus(target, {id:'fortalecido', icon:'⬆️', label:'Fortalecido', turns:2});
    applied.push('fortalecido');
  }
  
  if (d.includes('imagem espelhada')) {
  addStatus(target, {id:'mirror', icon:'🪞', label:'Im. Espelhada', turns:1});
  applied.push('mirror');
  }
  
  if (d.includes('escudo')) {
    var shieldVal = (attacker ? attacker.atq : target.atq) + Number(skill.power || 0);
    addStatus(target, {id:'shield', icon:'🛡️', label:'Escudo('+shieldVal+')', turns:2, val:shieldVal});
    applied.push('shield');
  }

  if (skill.id === 'sho' && attacker && attacker.id === 'kuro') {
    addStatus(target, {id:'marcado', icon:'🎯', label:'Marcado (2t)', turns:2});
    applied.push('marcado');
  }

  if (skill.id === 'tat' && attacker && attacker.id === 'kuro') {
    target.statuses = target.statuses.filter(function(s) { return s.id !== 'marcado'; });
    applied.push('marcado_consumido');
  }

  return applied;
                       }
// ── Passivos de início de batalha ───────────
function applyStartPassives(state) {
  var PATRULHEIROS = ['pt_cae','pt_elo','pt_zar','pt_var','pt_tha','pt_aer'];
  ['p1','p2'].forEach(function(o) {
    var chars = state[o].chars;
    var inimigo = o === 'p1' ? 'p2' : 'p1';
    chars.forEach(function(ch) {
      if (ch.id === 'pt_tha') {
        var n = chars.filter(function(c) { return c !== ch && PATRULHEIROS.indexOf(c.id) !== -1; }).length;
        if (n > 0) { ch.maxHp += n * 10; ch.hp += n * 10; }
      }
      if (ch.id === 'pt_cae') {
        var n = chars.filter(function(c) { return c !== ch && PATRULHEIROS.indexOf(c.id) !== -1; }).length;
        if (n > 0) {
          chars.filter(function(c) { return c !== ch; }).forEach(function(a) {
            a.curDef += n; a.def += n; a._caerynDef = (a._caerynDef || 0) + n;
          });
        }
      }
      if (ch.id === 'pt_var') {
        var n = chars.filter(function(c) { return c !== ch && PATRULHEIROS.indexOf(c.id) !== -1; }).length;
        if (n > 0) {
          chars.filter(function(c) { return c !== ch; }).forEach(function(a) {
            a.curAtq += n; a.atq += n; a._varokAtq = (a._varokAtq || 0) + n;
          });
        }
      }
      if (ch.id === 'pt_zar') {
        var n = chars.filter(function(c) { return c !== ch && PATRULHEIROS.indexOf(c.id) !== -1; }).length;
        if (n > 0) {
          chars.forEach(function(a) {
            a.skills = a.skills.map(function(sk) {
              var p = sk.power;
              if (typeof p === 'string' && p.indexOf('/') !== -1) {
                p = p.split('/').map(function(v) { return String(parseInt(v) + n); }).join('/');
              } else {
                p = (typeof p === 'number' ? p : parseInt(p)) + n;
              }
              return Object.assign({}, sk, { power: p });
            });
            a._zaraePow = (a._zaraePow || 0) + n;
          });
        }
      }
      if (ch.id === 'zeph') {
        chars.filter(function(c) { return c.id !== 'zeph'; }).forEach(function(a) {
          a.curAtq += 1; a.curDef += 1; a._inspirado = true;
        });
      }
      if (ch.id === 'tyre' && !ch._outfit) {
        ch._outfit = 'verde';
        addStatus(ch, {id:'outfit_verde', icon:'🟢', label:'Roupa Verde', turns:999});
      }
    });
    var caeryn = chars.find(function(c) { return c.id === 'pt_cae'; });
    if (caeryn && !caeryn._megazordUsed) {
      var totalPat = chars.filter(function(c) { return PATRULHEIROS.indexOf(c.id) !== -1; }).length;
      if (totalPat >= 3) {
        caeryn._megazordUsed = true;
        state[inimigo].chars.forEach(function(t) {
          if (t.alive) { t.hp -= 20; if (t.hp <= 0) { t.hp = 0; t.alive = false; } }
        });
      }
    }
  });
}
// ── Passivas ao nocautear ────────────────────
function checkOnKill(state, deadChar, killerOwner) {
  var deadOwner = killerOwner === 'p1' ? 'p2' : 'p1';
  var deadTeam = state[deadOwner].chars;
  var killerTeam = state[killerOwner].chars;
  var events = [];

  var kael = deadTeam.find(function(c) { return c.id === 'kael' && c.alive && c.id !== deadChar.id; });
  if (kael) {
    kael._furia = true;
    kael.hp = Math.min(kael.maxHp, kael.hp + Math.floor(kael.maxHp * 0.2));
    events.push({ type: 'kael_furia', kaelHp: kael.hp });
  }

  var lori = killerTeam.find(function(c) { return c.id === 'lori' && c.alive; });
  if (lori) {
    draw(state, killerOwner, 1);
    lori._extraTurn = true;
    lori.curAtq += 1; lori.atq += 1;
    lori.curDef += 1; lori.def += 1;
    events.push({ type: 'lori_kill', loriAtq: lori.curAtq, loriDef: lori.curDef });
  }

  var aliveAllies = deadTeam.filter(function(c) { return c.alive && c.id !== deadChar.id; });

  if (deadChar.id === 'pt_cae') {
    aliveAllies.forEach(function(c) {
      if (c._caerynDef) { c.curDef -= c._caerynDef; c.def -= c._caerynDef; c._caerynDef = 0; }
    });
    events.push({ type: 'caeryn_morte' });
  }
  if (deadChar.id === 'pt_var') {
    aliveAllies.forEach(function(c) {
      if (c._varokAtq) { c.curAtq -= c._varokAtq; c.atq -= c._varokAtq; c._varokAtq = 0; }
    });
    events.push({ type: 'varok_morte' });
  }
  if (deadChar.id === 'pt_zar') {
    aliveAllies.forEach(function(c) {
      if (c._zaraePow) {
        c.skills = c.skills.map(function(sk) {
          var p = sk.power;
          if (typeof p === 'string' && p.indexOf('/') !== -1) {
            p = p.split('/').map(function(v) { return String(parseInt(v) - c._zaraePow); }).join('/');
          } else {
            p = (typeof p === 'number' ? p : parseInt(p)) - c._zaraePow;
          }
          return Object.assign({}, sk, { power: p });
        });
        c._zaraePow = 0;
      }
    });
    events.push({ type: 'zarae_morte' });
  }
  if (deadChar.id === 'zeph') {
    aliveAllies.forEach(function(c) {
      if (c._inspirado) { c.curAtq -= 1; c.curDef -= 1; c._inspirado = false; }
    });
    events.push({ type: 'zephyr_morte' });
  }

  return events;
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
   applySkillEffects: applySkillEffects,
  applyStartPassives: applyStartPassives,
  checkOnKill: checkOnKill
};
