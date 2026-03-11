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
  // Busca dados dos personagens
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

module.exports = {
  buildDeck: buildDeck,
  makeChar: makeChar,
  initBattle: initBattle,
  draw: draw,
  discard: discard,
  checkWin: checkWin
};
