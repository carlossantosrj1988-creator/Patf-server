var gameInit = require('./game_init.js');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = {};

function send(ws, type, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function broadcast(room, type, data) {
  room.players.forEach(function(ws) {
    send(ws, type, data);
  });
}

// ── NOVO: Serializa um personagem para envio ao cliente ──
function serializeChar(c) {
  return {
    id:             c.id,
    hp:             c.hp,
    maxHp:          c.maxHp,
    alive:          c.alive,
    curAtq:         c.curAtq,
    curDef:         c.curDef,
    atq:            c.atq,
    def:            c.def,
    statuses:       c.statuses       || [],
    cooldowns:      c.cooldowns      || {},
    _outfit:        c._outfit,
    _charge:        c._charge,
    _satsui:        c._satsui,
    _linkAccum:     c._linkAccum,
    _furia:         c._furia,
    _extraTurn:     c._extraTurn,
    _chamadoTurno:  c._chamadoTurno,
    _agoraSerioPow: c._agoraSerioPow,
    quickAction:    c.quickAction
  };
}

// ── NOVO: Snapshot completo do state para o cliente ──
function snapshotState(state) {
  if (!state) return null;
  return {
    p1: { chars: state.p1.chars.map(serializeChar) },
    p2: { chars: state.p2.chars.map(serializeChar) }
  };
}

// ── Fase 9: Encerrar batalha ──
function endGame(room, winner, reason) {
  if (room.over) return;
  room.over = true;
  broadcast(room, 'game_over', { winner: winner, reason: reason });
  var roomId = Object.keys(rooms).find(function(id) { return rooms[id] === room; });
  if (roomId) {
    setTimeout(function() {
      delete rooms[roomId];
      console.log('[PATF] Sala encerrada:', roomId);
    }, 5000);
  }
}
function grantExtraTurn(room, charId, owner) {
  var state = room.state;
  var ch = state[owner].chars.find(function(c) { return c.id === charId; });
  if (!ch || !ch.alive) return;
  if (ch.extraTurnUsed) return;
  ch.extraTurnUsed = true;
  state.order.splice(state.orderIdx + 1, 0, { charId: charId, owner: owner, extra: true });
  broadcast(room, 'next_turn', {
    charId: charId,
    owner: owner,
    isExtraTurn: true,
    state: snapshotState(state)
  });
}
function advanceTurn(room) {
  var state = room.state;
  state.orderIdx = (state.orderIdx || 0) + 1;
  if (state.orderIdx >= state.order.length) {
    state.order = state.order.filter(function(e) { return !e.extra; });
    state.turn = (state.turn || 1) + 1;
    state.orderIdx = 0;
  }
  var current = state.order[state.orderIdx];
  var charId = current.charId;
  var owner = current.owner;

  var ch = state[owner].chars.find(function(c) { return c.id === charId; });

  if (ch && !ch.alive) {
    advanceTurn(room);
    return;
  }

  if (ch) {
    var hasFrozen = ch.statuses.find(function(s) { return s.id === 'frozen'; });
    var hasStun   = ch.statuses.find(function(s) { return s.id === 'stun'; });
    if ((hasFrozen || hasStun) && Math.random() < 0.5) {
      broadcast(room, 'turn_skipped', {
        charId: charId,
        owner: owner,
        reason: hasFrozen ? 'frozen' : 'stun',
        state: snapshotState(state)
      });
      advanceTurn(room);
      return;
    }
  }

  var dotEffects = [];
  if (ch) {
    dotEffects = gameInit.applyDoTs(ch);
  }
  var dotKillEvents = [];
  if (ch && !ch.alive) {
    var dotKillerOwner = owner === 'p1' ? 'p2' : 'p1';
    dotKillEvents = gameInit.checkOnKill(state, ch, dotKillerOwner);
  }

  if (dotEffects.length > 0) {
    broadcast(room, 'turn_effects', {
      charId: charId,
      owner: owner,
      effects: dotEffects,
      hp: ch.hp,
      alive: ch.alive,
      killEvents: dotKillEvents,
      state: snapshotState(state)
    });

    if (!ch.alive) {
      var winner = gameInit.checkWin(state);
      if (winner) {
        endGame(room, winner, 'dot');
        return;
      }
      advanceTurn(room);
      return;
    }
  }

  if (state.orderIdx === 0) {
    ['p1','p2'].forEach(function(o) {
      state[o].chars.forEach(function(c) {
        for (var sk in c.cooldowns) {
          if (c.cooldowns[sk] > 0) c.cooldowns[sk]--;
        }
      });
    });
  }

  var passiveEvents = [];

  if (ch && ch.id === 'zeph' && ch.alive) {
    if (Math.random() < 0.5) {
      gameInit.draw(state, owner, 1);
      passiveEvents.push({ type: 'sorte_grande', charId: charId });
    }
  }

  if (ch && ch.id === 'nyxa' && ch.alive) {
    if (Math.random() < 0.5) {
      ch.quickAction = true;
      passiveEvents.push({ type: 'nimb', charId: charId });
    } else {
      ch.quickAction = false;
    }
  }

  if (ch && ch.id === 'gora' && ch.alive) {
    var defBonus = Math.floor((1 - ch.hp / ch.maxHp) / 0.1);
    ch.curDef = ch.def + defBonus;
    if (defBonus > 0) passiveEvents.push({ type: 'sou_invencivel', charId: charId, defBonus: defBonus });
  }

  if (ch && ch.id === 'kael' && ch.alive) {
    var atqBonus = Math.floor((1 - ch.hp / ch.maxHp) / 0.1);
    ch.curAtq = ch.atq + atqBonus;
    if (atqBonus > 0) passiveEvents.push({ type: 'espirito_combate', charId: charId, atqBonus: atqBonus });
  }

  if (ch && ch.id === 'vanc' && ch.alive) {
    ch._chamadoTurno = (ch._chamadoTurno || 0) + 1;
    passiveEvents.push({ type: 'chamado_contador', charId: charId, turno: ch._chamadoTurno });
    if (ch._chamadoTurno % 3 === 0) {
      var inimigos = state[owner === 'p1' ? 'p2' : 'p1'].chars.filter(function(c) { return c.alive; });
      var aliados  = state[owner].chars.filter(function(c) { return c.alive && c.id !== 'vanc'; });
      var r = Math.random();
      var chamadoTipo, chamadoResultados = [];

      if (r < 0.3333) {
        chamadoTipo = 'jennet';
        inimigos.forEach(function(e) {
          gameInit.addStatus(e, {id:'bleed', icon:'🩸', label:'Sangramento', turns:2, stacks:1, stackMax:3});
          var bleedSt = e.statuses.find(function(s) { return s.id === 'bleed'; });
          var stacks = bleedSt ? (bleedSt.stacks || 1) : 1;
          var hDmg = 3 * stacks;
          e.hp -= hDmg;
          if (e.hp <= 0) { e.hp = 0; e.alive = false; }
          chamadoResultados.push({ charId: e.id, hp: e.hp, alive: e.alive, dano: hDmg });
        });
      } else if (r < 0.6666) {
        chamadoTipo = 'hoover';
        inimigos.forEach(function(e) {
          e.hp -= 10;
          if (e.hp <= 0) { e.hp = 0; e.alive = false; }
          chamadoResultados.push({ charId: e.id, hp: e.hp, alive: e.alive, dano: 10 });
        });
      } else {
        chamadoTipo = 'guinzu';
        var targets = aliados.length ? aliados : [ch];
        targets.forEach(function(a) {
          gameInit.addStatus(a, {id:'mirror', icon:'🧸', label:'Imagem Espelhada', turns:1});
          chamadoResultados.push({ charId: a.id });
        });
      }

      passiveEvents.push({ type: 'chamado_tropa', chamadoTipo: chamadoTipo, resultados: chamadoResultados });

      var winnerChamado = gameInit.checkWin(state);
      if (winnerChamado) { endGame(room, winnerChamado, 'battle'); return; }
    }
  }

  broadcast(room, 'next_turn', {
    charId: charId,
    owner: owner,
    turn: state.turn,
    passiveEvents: passiveEvents,
    curDef: ch ? ch.curDef : null,
    curAtq: ch ? ch.curAtq : null,
    quickAction: ch ? ch.quickAction : false,
    state: snapshotState(state)
  });

  if (room.actionTimer) clearTimeout(room.actionTimer);
  room.actionTimer = setTimeout(function() {
    if (!room.state || room.over) return;
    var cur = room.state.order[room.state.orderIdx];
    if (!cur) return;
    var skCh = room.state[cur.owner].chars.find(function(c) { return c.id === cur.charId && c.alive; });
    if (skCh) {
      if (skCh.id === 'sam') skCh._charge = Math.min(5, (skCh._charge || 0) + 1);
      if (skCh.id === 'tyre') skCh._linkAccum = Math.min(2, (skCh._linkAccum || 0) + 1);
      if (skCh.id === 'kuro') skCh._satsui = Math.min(10, (skCh._satsui || 0) + 2);
      if (skCh.id === 'gora') skCh._agoraSerioPow = 0;
      gameInit.draw(room.state, cur.owner, 1);
    }
    console.log('[PATF] Timer atacante expirou:', cur.charId);
    broadcast(room, 'turn_timeout', { charId: cur.charId, owner: cur.owner });
    room.actionTimer = null;
    advanceTurn(room);
  }, 90000);
}

app.get('/', function(req, res) {
  res.json({
    status: 'online',
    game: 'PATF TCG',
    rooms: Object.keys(rooms).length
  });
});

wss.on('connection', function(ws) {
  console.log('[PATF] Nova conexao');

  ws.on('message', function(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return send(ws, 'error', { message: 'JSON invalido' });
    }

    if (msg.type === 'join_room') {
      var roomId = msg.roomId;
      var uid = msg.uid || 'anon';

      if (!rooms[roomId]) {
        rooms[roomId] = {
          players: [],
          uids: [],
          created: Date.now()
        };
      }

      var room = rooms[roomId];

      var existingIndex = room.uids.indexOf(uid);
      if (existingIndex !== -1) {
        room.players[existingIndex] = ws;
        ws.roomId = roomId;
        ws.uid = uid;
        ws.playerIndex = existingIndex;
        if (room.disconnectTimer) {
          clearTimeout(room.disconnectTimer);
          room.disconnectTimer = null;
        }
        console.log('[PATF] Reconexao:', uid, 'sala:', roomId);
        send(ws, 'joined', {
          roomId: roomId,
          playerIndex: existingIndex,
          players: room.uids.length,
          reconnected: true
        });
        if (room.state) {
          var st = room.state;
          send(ws, 'reconnect_state', {
            p1Chars: st.p1.chars.map(serializeChar),
            p2Chars: st.p2.chars.map(serializeChar),
            order: st.order,
            orderIdx: st.orderIdx,
            turn: st.turn
          });
        }
        if (room.pendingAction) {
          var pa = room.pendingAction;
          var defOwnerPa = pa.attackerOwner === 'p1' ? 'p2' : 'p1';
          if (ws.playerIndex === (defOwnerPa === 'p1' ? 0 : 1)) {
            send(ws, 'defense_request', {
              atacante: pa.atacanteId,
              alvo: pa.alvoId,
              skillId: pa.skillId,
              skillName: pa.skillName,
              poder: pa.poder,
              atkCardNv: pa.atkCardNv,
              atkCardSuit: pa.atkCardSuit,
              attackerOwner: pa.attackerOwner
            });
          }
        }
        return;
      }

      if (room.players.length >= 2) {
        return send(ws, 'error', { message: 'Sala cheia' });
      }

      var playerIndex = room.players.length;
      room.players.push(ws);
      room.uids.push(uid);
      ws.roomId = roomId;
      ws.uid = uid;
      ws.playerIndex = playerIndex;
      console.log('[PATF] Jogador', uid, 'entrou na sala:', roomId, '(' + room.players.length + '/2)');

      send(ws, 'joined', {
        roomId: roomId,
        playerIndex: playerIndex,
        players: room.players.length
      });

      if (room.players.length === 2) {
        console.log('[PATF] Sala pronta:', roomId);
        broadcast(room, 'room_ready', {
          roomId: roomId,
          players: 2
        });
      }
    }

    else if (msg.type === 'ping') {
      send(ws, 'pong', { timestamp: Date.now() });
    }

    else if (msg.type === 'start_battle') {
      var room = rooms[ws.roomId];
      if (!room) return;
      if (ws.playerIndex !== 0) return;

      var p1Ids = msg.p1Ids;
      var p2Ids = msg.p2Ids;
      var state = gameInit.initBattle(p1Ids, p2Ids);

      if (state.error) {
        return send(ws, 'error', { message: state.error });
      }

      room.state = state;

      broadcast(room, 'battle_started', {
        message: 'Batalha iniciada!',
        p1Chars: state.p1.chars.map(function(c) {
          return { id: c.id, name: c.name, hp: c.hp, maxHp: c.maxHp };
        }),
        p2Chars: state.p2.chars.map(function(c) {
          return { id: c.id, name: c.name, hp: c.hp, maxHp: c.maxHp };
        })
      });

      ['p1','p2'].forEach(function(o) {
        var caeryn = state[o].chars.find(function(c) { return c.id === 'pt_cae'; });
        if (caeryn && caeryn._megazordUsed) {
          var inimigo = o === 'p1' ? 'p2' : 'p1';
          var resultados = state[inimigo].chars.map(function(t) {
            return { charId: t.id, hp: t.hp, alive: t.alive };
          });
          broadcast(room, 'emboscada_florestal', { resultados: resultados });
        }
      });
    }

    else if (msg.type === 'submit_initiative') {
      var room = rooms[ws.roomId];
      if (!room) return;

      var pl = ws.playerIndex === 0 ? 'p1' : 'p2';
      if (!room.initiatives) room.initiatives = {};
      room.initiatives[pl] = msg.choices;

      console.log('[PATF] Iniciativa recebida de', pl, 'sala:', ws.roomId);
      send(ws, 'initiative_waiting', {});

      if (room.initiatives.p1 && room.initiatives.p2) {
        var all = [];
        ['p1', 'p2'].forEach(function(o) {
          room.initiatives[o].forEach(function(choice) {
            all.push({
              charId: choice.charId,
              owner: o,
              cardNv: choice.cardNv,
              cardSuit: choice.cardSuit,
              tot: choice.cardNv + choice.inc
            });
          });
        });

        all.sort(function(a, b) {
          if (b.tot !== a.tot) return b.tot - a.tot;
          if (b.cardNv !== a.cardNv) return b.cardNv - a.cardNv;
          return Math.random() - 0.5;
        });

        if (!room.state) room.state = {};
        room.state.order = all;
        room.state.orderIdx = 0;
        room.initiatives = {};

        console.log('[PATF] Ordem definida:', all.map(function(a){ return a.charId; }).join(' → '));
        broadcast(room, 'initiative_result', { order: all });
      }
    }

    else if (msg.type === 'action') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;
      if (room.over) return;
      if (room.actionTimer) { clearTimeout(room.actionTimer); room.actionTimer = null; }

      var state = room.state;
      var atacanteId = msg.charId;
      var skillId = msg.skillId;
      var alvoId = msg.targetId;
      var atkCardNv = msg.atkCardNv || 0;
      var atkCardSuit = msg.atkCardSuit || 'neutral';
      var dono = ws.playerIndex === 0 ? 'p1' : 'p2';
      var inimigo = dono === 'p1' ? 'p2' : 'p1';

      var atacante = state[dono].chars.find(function(c) {
        return c.id === atacanteId && c.alive;
      });
      var skill = atacante ? atacante.skills.find(function(s) { return s.id === skillId; }) : null;
      var alvo = state[inimigo].chars.find(function(c) { return c.id === alvoId && c.alive; });

      if (!atacante || !skill) return send(ws, 'error', { message: 'Acao invalida' });
      if (!alvo && !(msg.isArea && msg.targetIds && msg.targetIds.length > 0) && skill.target !== 'all_ally') {
        return send(ws, 'error', { message: 'Acao invalida' });
      }
      if (atacante.cooldowns[skillId] > 0) return send(ws, 'error', { message: 'Skill em recarga' });

      if (Number(skill.power) === 0 && (skill.type === 'Encanto' || skill.type === 'Melhoria' || skill.type === 'Suporte')) {
        atkCardNv = 0;
      }

      if (skill.recarga === 'L') {
        atacante.cooldowns[skillId] = 2;
      } else if (skill.acao === 'Rápida' && skill.recarga === 'N') {
        atacante.cooldowns[skillId] = 1;
      }
      if (atacante.statuses.find(function(s) { return s.id === 'slow'; }) && skill.recarga === 'N') {
        atacante.cooldowns[skillId] = 2;
      }

      // ── all: Nyxa/Azar ou Sorte ──
      if (skill.target === 'all') {
        var cardNvAll = atkCardNv;
        var base = atacante.curAtq + Number(skill.power) + cardNvAll;
        var allCharsAzs = state.p1.chars.concat(state.p2.chars).filter(function(c) { return c.alive; });
        var azsResultados = [];
        allCharsAzs.forEach(function(t) {
          if (Math.random() < 0.5) {
            var final = Math.max(0, base - t.curDef);
            t.hp -= final;
            if (t.hp <= 0) { t.hp = 0; t.alive = false; }
            azsResultados.push({ charId: t.id, dano: final, cura: 0, hp: t.hp, morreu: !t.alive });
          } else {
            var prev = t.hp;
            t.hp = Math.min(t.maxHp, t.hp + base);
            azsResultados.push({ charId: t.id, dano: 0, cura: t.hp - prev, hp: t.hp, morreu: false });
          }
        });
        broadcast(room, 'azs_result', {
          atacante: atacanteId,
          resultados: azsResultados,
          state: snapshotState(state)
        });
        var winnerAzs = gameInit.checkWin(state);
        if (winnerAzs) { endGame(room, winnerAzs, 'battle'); return; }
        advanceTurn(room);
        return;
      }

      // ── all_ally ──
      if (skill.target === 'all_ally') {
        var aliados = state[dono].chars.filter(function(c) { return c.alive; });
        aliados.forEach(function(aliado) {
          var efeitoAlly = gameInit.applySkillEffects(skill, aliado, atacante);
          if (skill.type === 'Cura' && skill.power > 0) {
            aliado.hp = Math.min(aliado.maxHp, aliado.hp + Number(skill.power));
          }
          broadcast(room, 'action_result', {
            atacante: atacanteId, skill: skillId, alvo: aliado.id,
            dano: 0, hpAlvo: aliado.hp, morreu: false,
            statusApplied: efeitoAlly, isAlly: true,
            state: snapshotState(state)
          });
        });
        advanceTurn(room);
        return;
      }

      // ── Área ──
      if (msg.isArea && msg.targetIds && msg.targetIds.length > 0) {
        var alvosArea = msg.targetIds.map(function(tid) {
          return state[inimigo].chars.find(function(c) { return c.id === tid && c.alive; });
        }).filter(Boolean);
        if (alvosArea.length === 0) return;

        room.pendingAreaAction = {
          atacanteId: atacanteId, skillId: skillId, skillName: skill.name,
          poder: skill.power, atkCardNv: atkCardNv, atkCardSuit: atkCardSuit,
          atacante: atacante, attackerOwner: dono,
          alvos: alvosArea, areaIdx: 0, areaTotal: alvosArea.length, resultados: []
        };

        var defAreaWs = room.players[inimigo === 'p1' ? 0 : 1];
        send(defAreaWs, 'defense_request', {
          atacante: atacanteId, alvo: alvosArea[0].id, skillId: skillId,
          skillName: skill.name, poder: skill.power, atkCardNv: atkCardNv,
          atkCardSuit: atkCardSuit, attackerOwner: dono,
          isArea: true, areaCurrent: 1, areaTotal: alvosArea.length
        });
        return;
      }

      // ── Melt/Catastrófico ──
      var hasMelt = skill.desc.includes('Derreter Armadura') || skill.desc.includes('Catastrofico');
      var ignoreArmor = skill.desc.includes('Ignora Armadura') || skill.desc.includes('Catastrofico');
      if (hasMelt) {
        var defMeltTotal = ignoreArmor ? 0 : alvo.def;
        var poderMelt = skill.power;
        if (typeof poderMelt === 'string' && poderMelt.indexOf('/') !== -1) {
          poderMelt = poderMelt.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0);
        }
        var danoMelt = gameInit.resolveAttack(atacante.atq + atkCardNv, poderMelt, defMeltTotal);
        alvo.hp -= danoMelt;
        if (alvo.hp <= 0) { alvo.hp = 0; alvo.alive = false; }
        var stMelt = gameInit.applySkillEffects(skill, alvo);
        broadcast(room, 'action_result', {
          atacante: atacanteId, skill: skillId, alvo: alvoId,
          dano: danoMelt, hpAlvo: alvo.hp, morreu: !alvo.alive,
          statusApplied: stMelt, melt: true,
          state: snapshotState(state)
        });
        var winnerMelt = gameInit.checkWin(state);
        if (winnerMelt) { endGame(room, winnerMelt, 'battle'); return; }
        advanceTurn(room);
        return;
      }

      // ── Efeito puro ──
      if (Number(skill.power) === 0 && (skill.type === 'Encanto' || skill.type === 'Melhoria' || skill.type === 'Suporte')) {
        var efeitoPuro = gameInit.applySkillEffects(skill, alvo);
        if (skillId === 'ago' && atacante.id === 'gora') {
          atacante._agoraSerio = true;
          atacante._agoraSerioPow = 0;
        }
        if (skillId === 'rou' && atacante.id === 'tyre') {
          var outfitNext = msg.outfitNext || 'verde';
          ['outfit_verde','outfit_azul','outfit_vermelha'].forEach(function(id) {
            atacante.statuses = atacante.statuses.filter(function(s) { return s.id !== id; });
          });
          atacante._outfit = outfitNext;
          atacante.statuses.push({
            id: 'outfit_'+outfitNext,
            icon: outfitNext==='verde'?'🟢':outfitNext==='azul'?'🔵':'🔴',
            label: outfitNext==='verde'?'Roupa Verde':outfitNext==='azul'?'Roupa Azul':'Roupa Vermelha',
            turns: 999
          });
        }
        broadcast(room, 'action_result', {
          atacante: atacanteId, skill: skillId, alvo: alvoId,
          dano: 0, hpAlvo: alvo.hp, morreu: false,
          statusApplied: efeitoPuro,
          outfitNext: (skillId === 'rou' ? (msg.outfitNext || 'verde') : undefined),
          state: snapshotState(state)
        });
        if (msg.isQuickAction) {
          broadcast(room, 'next_turn', { charId: atacanteId, owner: dono, isQuickAction: true, state: snapshotState(state) });
        } else {
          advanceTurn(room);
        }
        return;
      }

      // ── Ação normal: guarda pendingAction e pede defesa ──
      room.pendingAction = {
        atacanteId: atacanteId, skillId: skillId, skillName: skill.name,
        poder: skill.power, alvoId: alvoId, atkCardNv: atkCardNv,
        atkCardSuit: atkCardSuit, atacante: atacante, alvo: alvo,
        attackerOwner: dono, isQuickAction: !!(msg.isQuickAction),
        extraCardNvs: msg.extraCardNvs || []
      };

      if (skillId === 'sen' && atacante.id === 'voss') {
        atacante._spiderExtraTurn = true;
      }

      var interceptorId = null;
      var interceptType = null;
      var defOwnerI = inimigo;
      var alvoAtualI = alvo;
      var skAtacante = atacante.skills.find(function(s) { return s.id === skillId; });
      var acaoI = skAtacante ? skAtacante.acao : 'N';
      if (acaoI !== 'F') {
        if (alvoAtualI.id !== 'pt_aer') {
          var aeryn = state[defOwnerI].chars.find(function(c) { return c.id === 'pt_aer' && c.alive; });
          if (aeryn && (alvoAtualI.hp / alvoAtualI.maxHp) <= 0.20) {
            interceptorId = 'pt_aer'; interceptType = 'lider';
            room.pendingAction.alvo = aeryn; room.pendingAction.alvoId = 'pt_aer';
          }
        }
        if (!interceptorId && alvoAtualI.id !== 'tyre' && acaoI !== 'Rápida') {
          var tyreI = state[defOwnerI].chars.find(function(c) {
            return c.id === 'tyre' && c.alive && c.statuses.find(function(s) { return s.id === 'outfit_azul'; });
          });
          if (tyreI) { interceptorId = 'tyre'; interceptType = 'azul'; room.pendingAction.alvo = tyreI; room.pendingAction.alvoId = 'tyre'; }
        }
        if (!interceptorId && alvoAtualI.id !== 'gora' && acaoI !== 'Rápida') {
          var goraI = state[defOwnerI].chars.find(function(c) { return c.id === 'gora' && c.alive; });
          if (goraI) { interceptorId = 'gora'; interceptType = 'defender_fracos'; room.pendingAction.alvo = goraI; room.pendingAction.alvoId = 'gora'; }
        }
      }

      var defensorWs = room.players[inimigo === 'p1' ? 0 : 1];
      send(defensorWs, 'defense_request', {
        atacante: atacanteId, alvo: room.pendingAction.alvoId,
        skillId: skillId, skillName: skill.name, poder: skill.power,
        atkCardNv: atkCardNv, atkCardSuit: atkCardSuit,
        attackerOwner: dono, interceptedBy: interceptorId, interceptType: interceptType
      });

      if (room.defenseTimer) clearTimeout(room.defenseTimer);
      room.defenseTimer = setTimeout(function() {
        if (!room.state || room.over || !room.pendingAction) return;
        console.log('[PATF] Timer defensor expirou');
        room.defenseTimer = null;
        var pa = room.pendingAction;
        room.pendingAction = null;
        broadcast(room, 'action_result', {
          atacante: pa.atacanteId, skill: pa.skillId, alvo: pa.alvoId,
          dano: 0, hpAlvo: pa.alvo.hp, morreu: false,
          esquivou: true, defTimedOut: true,
          state: snapshotState(room.state)
        });
        advanceTurn(room);
      }, 30000);
    }

    else if (msg.type === 'defense_response') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;
      if (room.over) return;
      if (room.defenseTimer) { clearTimeout(room.defenseTimer); room.defenseTimer = null; }
      if (!room.pendingAction && !room.pendingAreaAction) return;

      // ── Área ──
      if (room.pendingAreaAction) {
        var paa = room.pendingAreaAction;
        var alvoAtual = paa.alvos[paa.areaIdx];
        var defOwner = paa.attackerOwner === 'p1' ? 'p2' : 'p1';
        var defAreaWs = room.players[defOwner === 'p1' ? 0 : 1];
        var defCardNv = msg.defCardNv || 0;
        var isJack = msg.isJack || false;

        if (isJack) {
          paa.resultados.push({ alvoId: alvoAtual.id, dano: 0, hpAlvo: alvoAtual.hp, morreu: false, esquivou: true });
        } else {
          var poderAreaTotal = paa.poder;
          if (typeof paa.poder === 'string' && paa.poder.indexOf('/') !== -1) {
            poderAreaTotal = paa.poder.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0);
          }
          var ignoreArmorArea = paa.atacante.skills.find(function(s) { return s.id === paa.skillId; });
          ignoreArmorArea = ignoreArmorArea && (ignoreArmorArea.desc.includes('Ignora Armadura') || ignoreArmorArea.desc.includes('Catastrofico'));
          var defAreaTotal = ignoreArmorArea ? 0 : (alvoAtual.def + defCardNv);

          var criticoArea = false;
          if (paa.skillId === 'wpn' && Math.random() < 0.5) { poderAreaTotal = poderAreaTotal * 2; criticoArea = true; }
          if (paa.skillId === 'web') { var temLentoA = alvoAtual.statuses.find(function(s) { return s.id === 'slow'; }); if (temLentoA) { poderAreaTotal = poderAreaTotal * 2; criticoArea = true; } }
          if (paa.skillId === 'uni') { var temCondA = alvoAtual.statuses.find(function(s) { return s.id === 'exposed' || s.id === 'weak'; }); if (temCondA) { poderAreaTotal = poderAreaTotal * 2; criticoArea = true; } }
          if (paa.skillId === 'eli2') { var idxExpA = alvoAtual.statuses.findIndex(function(s) { return s.id === 'exposed'; }); if (idxExpA !== -1) { alvoAtual.statuses.splice(idxExpA, 1); alvoAtual.curDef = alvoAtual.def; poderAreaTotal = poderAreaTotal * 2; criticoArea = true; } }
          if (paa.skillId === 'tcz') { var debuffsA = ['burn','bleed','rad','static','chill','frozen','stun','exposed','weak','amaciado','melt','slow']; var countDebuffsA = alvoAtual.statuses.filter(function(s) { return debuffsA.indexOf(s.id) !== -1; }).length; poderAreaTotal = poderAreaTotal + (3 * countDebuffsA); }
          if (paa.skillId === 'fpl' || paa.skillId === 'ffr') { var cargasA = paa.atacante._charge || 0; poderAreaTotal = cargasA; paa.atacante._charge = 0; }
          if (paa.skillId === 'aes') { var accumA = paa.atacante._linkAccum || 0; if (accumA >= 2) { paa.isAreaOverride = true; } else if (accumA >= 1) { paa.ignoreArmorOverride = true; } paa.atacante._linkAccum = 0; }
          if (paa.skillId === 'had') { var satsuiA = paa.atacante._satsui || 0; poderAreaTotal = 5 + (satsuiA * 2); paa.atacante._satsui = 0; }
          if (paa.skillId === 'sho') { var jaMarcadoA = alvoAtual.statuses.find(function(s) { return s.id === 'marcado'; }); if (jaMarcadoA) { poderAreaTotal = poderAreaTotal * 2; } }
          if (paa.skillId === 'tat') { var marcadoTatA = alvoAtual.statuses.find(function(s) { return s.id === 'marcado'; }); if (marcadoTatA) { poderAreaTotal = poderAreaTotal * 3; } }

          var danoArea = gameInit.resolveAttack(paa.atacante.atq + paa.atkCardNv, poderAreaTotal, defAreaTotal);
          alvoAtual.hp -= danoArea;
          if (alvoAtual.hp <= 0) { alvoAtual.hp = 0; alvoAtual.alive = false; }
          var skArea = paa.atacante.skills.find(function(s) { return s.id === paa.skillId; });
          var stArea = skArea ? gameInit.applySkillEffects(skArea, alvoAtual) : [];
          paa.resultados.push({ alvoId: alvoAtual.id, dano: danoArea, hpAlvo: alvoAtual.hp, morreu: !alvoAtual.alive, esquivou: false, statusApplied: stArea, critico: criticoArea });
        }

        paa.areaIdx++;
        if (paa.areaIdx < paa.alvos.length) {
          var proximo = paa.alvos[paa.areaIdx];
          send(defAreaWs, 'defense_request', {
            atacante: paa.atacanteId, alvo: proximo.id, skillId: paa.skillId,
            skillName: paa.skillName, poder: paa.poder, atkCardNv: paa.atkCardNv,
            atkCardSuit: paa.atkCardSuit, attackerOwner: paa.attackerOwner,
            isArea: true, areaCurrent: paa.areaIdx + 1, areaTotal: paa.areaTotal
          });
          return;
        }

        paa.resultados.forEach(function(r) {
          broadcast(room, 'action_result', {
            atacante: paa.atacanteId, skill: paa.skillId, alvo: r.alvoId,
            dano: r.dano, hpAlvo: r.hpAlvo, morreu: r.morreu,
            esquivou: r.esquivou, statusApplied: r.statusApplied || [], isArea: true,
            state: snapshotState(room.state)
          });
        });

        room.pendingAreaAction = null;
        var winnerArea = gameInit.checkWin(room.state);
        if (winnerArea) { endGame(room, winnerArea, 'battle'); return; }
        if (paa.atacante.skills.find(function(s) { return s.id === paa.skillId && s.acao === 'Rápida'; })) {
          setTimeout(function() {
            broadcast(room, 'next_turn', { charId: paa.atacanteId, owner: paa.attackerOwner, isQuickAction: true, state: snapshotState(room.state) });
          }, 4500);
        } else {
          advanceTurn(room);
        }
        return;
      }

      var state = room.state;
      var pa = room.pendingAction;
      room.pendingAction = null;
      var defCardNv = msg.defCardNv || 0;
      var isJack = msg.isJack || false;
      var atacante = pa.atacante;
      var alvo = pa.alvo;

      if (isJack) {
        broadcast(room, 'action_result', {
          atacante: pa.atacanteId, skill: pa.skillId, alvo: pa.alvoId,
          dano: 0, hpAlvo: alvo.hp, morreu: false, esquivou: true,
          state: snapshotState(state)
        });
        if (alvo.id === 'voss' && alvo._spiderExtraTurn) {
          alvo._spiderExtraTurn = false;
          grantExtraTurn(room, alvo.id, pa.attackerOwner === 'p1' ? 'p2' : 'p1');
        } else {
          advanceTurn(room);
        }
      } else {
        var poderTotal = pa.poder;
        if (typeof pa.poder === 'string' && pa.poder.indexOf('/') !== -1) {
          var hits = pa.poder.split('/');
          var extraNvs = pa.extraCardNvs || [];
          poderTotal = hits.reduce(function(acc, v, i) { return acc + Number(v) + (i > 0 ? (extraNvs[i-1] || 0) : 0); }, 0);
        }

        var ignoreArmor = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
        ignoreArmor = ignoreArmor && (ignoreArmor.desc.includes('Ignora Armadura') || ignoreArmor.desc.includes('Catastrofico'));
        var defTotal = ignoreArmor ? 0 : (alvo.def + defCardNv);

        var critico = false;
        if (pa.skillId === 'wpn' && Math.random() < 0.5) { poderTotal = poderTotal * 2; critico = true; }
        if (pa.skillId === 'web') { var temLento = alvo.statuses.find(function(s) { return s.id === 'slow'; }); if (temLento) { poderTotal = poderTotal * 2; critico = true; } }
        if (pa.skillId === 'uni') { var temCond = alvo.statuses.find(function(s) { return s.id === 'exposed' || s.id === 'weak'; }); if (temCond) { poderTotal = poderTotal * 2; critico = true; } }
        if (pa.skillId === 'eli2') { var idxExp = alvo.statuses.findIndex(function(s) { return s.id === 'exposed'; }); if (idxExp !== -1) { alvo.statuses.splice(idxExp, 1); alvo.curDef = alvo.def; poderTotal = poderTotal * 2; critico = true; } }
        if (pa.skillId === 'tcz') { var debuffs = ['burn','bleed','rad','static','chill','frozen','stun','exposed','weak','amaciado','melt','slow']; var countDebuffs = alvo.statuses.filter(function(s) { return debuffs.indexOf(s.id) !== -1; }).length; poderTotal = poderTotal + (3 * countDebuffs); }
        if (pa.skillId === 'fpl' || pa.skillId === 'ffr') { var cargas = atacante._charge || 0; poderTotal = cargas; if (cargas >= 5) { msg.isArea = true; } atacante._charge = 0; }
        if (pa.skillId === 'aes') { var accum = atacante._linkAccum || 0; if (accum >= 2) { pa.isAreaOverride = true; } else if (accum >= 1) { pa.ignoreArmorOverride = true; } atacante._linkAccum = 0; }
        if (pa.skillId === 'had') { var satsui = atacante._satsui || 0; poderTotal = 5 + (satsui * 2); atacante._satsui = 0; }
        if (pa.skillId === 'sho') { var jaMarcado = alvo.statuses.find(function(s) { return s.id === 'marcado'; }); if (jaMarcado) { poderTotal = poderTotal * 2; } }
        if (pa.skillId === 'tat') { var marcadoTat = alvo.statuses.find(function(s) { return s.id === 'marcado'; }); if (marcadoTat) { poderTotal = poderTotal * 3; } }
        if (alvo.id === 'gora' && alvo.alive) { alvo._agoraSerioPow = (alvo._agoraSerioPow || 0) + 4; }
        if (pa.skillId === 'atc' && atacante.id === 'gora') { poderTotal = poderTotal + (atacante._agoraSerioPow || 0); atacante._agoraSerioPow = 0; }

        var dano = gameInit.resolveAttack(atacante.atq + pa.atkCardNv, poderTotal, defTotal);
        alvo.hp -= dano;
        if (alvo.hp <= 0) { alvo.hp = 0; alvo.alive = false; }

        // Naipe Advantage
        var suitAdv = null;
        var skNaipe = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
        var acaoNaipe = skNaipe ? skNaipe.acao : 'N';
        if (pa.atacante.suit !== 'neutral' && pa.alvo.suit !== 'neutral' && acaoNaipe !== 'F') {
          if (pa.atacante.suit === 'spades' && pa.alvo.suit === 'hearts') {
            alvo.hp += dano; dano = dano * 2; alvo.hp -= dano;
            if (alvo.hp <= 0) { alvo.hp = 0; alvo.alive = false; }
            suitAdv = { type: 'spades_hearts' };
          }
          if ((pa.atacante.suit === 'hearts' && pa.alvo.suit === 'clubs') || (pa.atacante.suit === 'clubs' && pa.alvo.suit === 'hearts')) {
            var heartsChar = pa.atacante.suit === 'hearts' ? pa.atacante : pa.alvo;
            var clubsChar  = pa.atacante.suit === 'clubs'  ? pa.atacante : pa.alvo;
            var existingHA = heartsChar.statuses.find(function(s) { return s.id === 'hearts_adv'; });
            if (existingHA) { existingHA.turns = 2; heartsChar.curAtq = heartsChar.atq * 2; heartsChar.curDef = heartsChar.def * 2; }
            else { heartsChar.curAtq = heartsChar.atq * 2; heartsChar.curDef = heartsChar.def * 2; heartsChar.statuses.push({id:'hearts_adv', icon:'❤️', label:'Bônus Copas: ATQ/DEF×2 (2t)', turns:2}); }
            suitAdv = { type: 'hearts_clubs', heartsCharId: heartsChar.id, clubsCharId: clubsChar.id };
          }
          if (pa.atacante.suit === 'diamonds' && pa.alvo.suit === 'clubs' && pa.alvo.alive) {
            var clubsCh = pa.alvo;
            var firstSk = clubsCh.skills[0];
            var poderCC = firstSk ? (typeof firstSk.power === 'string' && firstSk.power.indexOf('/') !== -1 ? firstSk.power.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0) : Number(firstSk.power)) : 0;
            var danoCC = Math.max(0, clubsCh.curAtq + poderCC - pa.atacante.curDef);
            var jaFurtivo = clubsCh.statuses.find(function(s) { return s.id === 'clubs_furtivo'; });
            if (jaFurtivo) { jaFurtivo.turns = 2; } else { clubsCh.statuses.push({id:'clubs_furtivo', icon:'🌿', label:'Paus: Furtivo (2t)', turns:2}); }
            pa.atacante.hp -= danoCC;
            if (pa.atacante.hp <= 0) { pa.atacante.hp = 0; pa.atacante.alive = false; }
            suitAdv = { type: 'clubs_counter', clubsCharId: clubsCh.id, targetId: pa.atacanteId, dano: danoCC, targetHp: pa.atacante.hp, targetMorreu: !pa.atacante.alive };
          }
          if (pa.alvo.suit === 'clubs' && pa.alvo.alive && pa.atacante.suit !== 'diamonds' && acaoNaipe !== 'F' && pa.alvo.statuses.find(function(s) { return s.id === 'clubs_furtivo'; })) {
            var clubsFCh = pa.alvo;
            var firstSkF = clubsFCh.skills[0];
            var poderCF = firstSkF ? (typeof firstSkF.power === 'string' && firstSkF.power.indexOf('/') !== -1 ? firstSkF.power.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0) : Number(firstSkF.power)) : 0;
            var danoCF = Math.max(0, clubsFCh.curAtq + poderCF - pa.atacante.curDef);
            pa.atacante.hp -= danoCF;
            if (pa.atacante.hp <= 0) { pa.atacante.hp = 0; pa.atacante.alive = false; }
            suitAdv = { type: 'clubs_counter', clubsCharId: clubsFCh.id, targetId: pa.atacanteId, dano: danoCF, targetHp: pa.atacante.hp, targetMorreu: !pa.atacante.alive };
          }
        }

        var killEvents = [];
        if (!alvo.alive) { killEvents = gameInit.checkOnKill(state, alvo, pa.attackerOwner); }

        // Nyxa Máscaras
        var PATRULHEIROS_8J = ['pt_cae','pt_elo','pt_zar','pt_var','pt_tha'];
        var reactEvents = [];
        var skAtacanteAeryn = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
        var acaoAtacanteAeryn = skAtacanteAeryn ? skAtacanteAeryn.acao : 'N';

        if (acaoAtacanteAeryn !== 'F') {
          var defOwnerNyxa = pa.attackerOwner === 'p1' ? 'p2' : 'p1';
          var nyxaFeliz = state[defOwnerNyxa].chars.find(function(c) { return c.id === 'nyxa' && c.alive && c.id !== pa.alvoId && c.statuses.find(function(s) { return s.id === 'masc_feliz'; }); });
          if (nyxaFeliz) {
            var dadSkF = nyxaFeliz.skills.find(function(s) { return s.id === 'dad'; });
            if (dadSkF && pa.atacante.alive) {
              var poderDadF = typeof dadSkF.power === 'string' && dadSkF.power.indexOf('/') !== -1 ? dadSkF.power.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0) : Number(dadSkF.power);
              var danoDadF = Math.max(0, nyxaFeliz.curAtq + poderDadF - pa.atacante.curDef);
              pa.atacante.hp -= danoDadF;
              if (pa.atacante.hp <= 0) { pa.atacante.hp = 0; pa.atacante.alive = false; }
              reactEvents.push({ type: 'nyxa_feliz', dano: danoDadF, targetId: pa.atacanteId, targetHp: pa.atacante.hp, targetMorreu: !pa.atacante.alive });
            }
          }
          var nyxaTriste = state[pa.attackerOwner].chars.find(function(c) { return c.id === 'nyxa' && c.alive && c.id !== pa.atacanteId && c.statuses.find(function(s) { return s.id === 'masc_triste'; }); });
          if (nyxaTriste && alvo.alive) {
            var dadSkT = nyxaTriste.skills.find(function(s) { return s.id === 'dad'; });
            if (dadSkT) {
              var poderDadT = typeof dadSkT.power === 'string' && dadSkT.power.indexOf('/') !== -1 ? dadSkT.power.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0) : Number(dadSkT.power);
              var danoDadT = Math.max(0, nyxaTriste.curAtq + poderDadT - alvo.curDef);
              alvo.hp -= danoDadT;
              if (alvo.hp <= 0) { alvo.hp = 0; alvo.alive = false; }
              reactEvents.push({ type: 'nyxa_triste', dano: danoDadT, targetId: pa.alvoId, targetHp: alvo.hp, targetMorreu: !alvo.alive });
            }
          }
        }

        // Aeryn ataque conjunto e contra-ataque
        if (PATRULHEIROS_8J.indexOf(pa.atacanteId) !== -1 && acaoAtacanteAeryn !== 'F') {
          var aerynJunto = state[pa.attackerOwner].chars.find(function(c) { return c.id === 'pt_aer' && c.alive; });
          if (aerynJunto && Math.random() < 0.5) {
            var eli2skJ = aerynJunto.skills.find(function(s) { return s.id === 'eli2'; });
            if (eli2skJ && alvo.alive) {
              var danoAerynJ = Math.max(0, aerynJunto.curAtq + Number(eli2skJ.power) - alvo.curDef);
              alvo.hp -= danoAerynJ;
              if (alvo.hp <= 0) { alvo.hp = 0; alvo.alive = false; }
              reactEvents.push({ type: 'aeryn_junto', dano: danoAerynJ, targetId: pa.alvoId, targetHp: alvo.hp, targetMorreu: !alvo.alive });
            }
          }
        }
        if (acaoAtacanteAeryn !== 'F') {
          var defOwnerAeryn = pa.attackerOwner === 'p1' ? 'p2' : 'p1';
          var aerynContra = state[defOwnerAeryn].chars.find(function(c) { return c.id === 'pt_aer' && c.alive && c.id !== pa.alvoId; });
          if (aerynContra) {
            var patAliados = state[defOwnerAeryn].chars.filter(function(c) { return c.alive && PATRULHEIROS_8J.indexOf(c.id) !== -1; });
            if (patAliados.length >= 2 && Math.random() < 0.5) {
              var eli2skC = aerynContra.skills.find(function(s) { return s.id === 'eli2'; });
              if (eli2skC && pa.atacante.alive) {
                var danoAerynC = Math.max(0, aerynContra.curAtq + Number(eli2skC.power) - pa.atacante.curDef);
                pa.atacante.hp -= danoAerynC;
                if (pa.atacante.hp <= 0) { pa.atacante.hp = 0; pa.atacante.alive = false; }
                reactEvents.push({ type: 'aeryn_contra', dano: danoAerynC, targetId: pa.atacanteId, targetHp: pa.atacante.hp, targetMorreu: !pa.atacante.alive });
              }
            }
          }
        }

        // Kael contra-ataque
        var counterEvent = null;
        if (alvo.id === 'kael' && alvo.alive && alvo._furia) {
          var skAcaoKael = atacante.skills.find(function(s) { return s.id === pa.skillId; });
          if (!skAcaoKael || skAcaoKael.acao !== 'F') {
            var atacanteTemBleed = atacante.statuses.find(function(s) { return s.id === 'bleed'; });
            if (atacanteTemBleed) {
              var furSk = alvo.skills.find(function(s) { return s.id === 'fur'; });
              if (furSk) {
                var caDmg = Math.max(0, alvo.curAtq + Number(furSk.power) - atacante.curDef);
                atacante.hp -= caDmg;
                if (atacante.hp <= 0) { atacante.hp = 0; atacante.alive = false; }
                counterEvent = { type: 'kael_furia_contra', dano: caDmg, targetId: pa.atacanteId, targetHp: atacante.hp, targetMorreu: !atacante.alive };
              }
            }
          }
        }

        var skill = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
        var statusApplied = [];
        if (skill) { statusApplied = gameInit.applySkillEffects(skill, alvo); }

        var extraTurnGranted = false;
        if (killEvents.length > 0) {
          var lori = state[pa.attackerOwner].chars.find(function(c) { return c.id === 'lori' && c.alive && c._extraTurn; });
          if (lori) { lori._extraTurn = false; extraTurnGranted = true; grantExtraTurn(room, 'lori', pa.attackerOwner); }
        }

        broadcast(room, 'action_result', {
          atacante: pa.atacanteId, skill: pa.skillId, alvo: pa.alvoId,
          dano: dano, hpAlvo: alvo.hp, morreu: !alvo.alive,
          statusApplied: statusApplied, critico: critico,
          killEvents: killEvents, counterEvent: counterEvent,
          reactEvents: reactEvents, suitAdv: suitAdv,
          atkCardNv: pa.atkCardNv, poderUsado: poderTotal,
          defTotal: defTotal, atkAtq: atacante.curAtq,
          state: snapshotState(state)
        });

        var winner = gameInit.checkWin(state);
        if (winner) { endGame(room, winner, 'battle'); return; }

        if (pa.atacante.suit === 'diamonds' && pa.alvo.suit === 'spades') {
          grantExtraTurn(room, pa.atacanteId, pa.attackerOwner);
          extraTurnGranted = true;
        }
        if (!extraTurnGranted && pa.alvo.alive && pa.atacante.suit === 'spades' && pa.alvo.suit === 'diamonds') {
          var defOwnerNaipe = pa.attackerOwner === 'p1' ? 'p2' : 'p1';
          grantExtraTurn(room, pa.alvoId, defOwnerNaipe);
          extraTurnGranted = true;
        }

        // Tyre Roupa Vermelha
        var skAtacanteTyre = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
        var acaoTyre = skAtacanteTyre ? skAtacanteTyre.acao : 'N';
        var tyreVermelha = state[pa.attackerOwner === 'p1' ? 'p2' : 'p1'].chars.find(function(c) {
          return c.id === 'tyre' && c.alive && c.id === pa.alvoId && c.statuses.find(function(s) { return s.id === 'outfit_vermelha'; });
        });
        if (tyreVermelha && acaoTyre !== 'F' && acaoTyre !== 'Rápida') {
          room.pendingCounter = { tyre: tyreVermelha, atacanteId: pa.atacanteId, atacante: pa.atacante, attackerOwner: pa.attackerOwner, isQuickAction: pa.isQuickAction };
          var tyreOwner = pa.attackerOwner === 'p1' ? 'p2' : 'p1';
          var tyreWs = room.players[tyreOwner === 'p1' ? 0 : 1];
          send(tyreWs, 'counter_request', { charId: 'tyre', reason: 'roupa_vermelha' });
          return;
        }

        // Kuro Concentração Marcial
        if (pa.atacanteId === 'kuro' && pa.atacante.alive) {
          pa.atacante._satsui = Math.min(10, (pa.atacante._satsui || 0) + 1);
          broadcast(room, 'skip_passive', { charId: 'kuro', type: 'kuro_satsui', satsui: pa.atacante._satsui });
        }

        if (pa.isQuickAction) {
          setTimeout(function() {
            broadcast(room, 'next_turn', { charId: pa.atacanteId, owner: pa.attackerOwner, isQuickAction: true, state: snapshotState(state) });
          }, 4500);
        } else if (!extraTurnGranted) {
          setTimeout(function() { advanceTurn(room); }, 4500);
        }
      }
    }

    else if (msg.type === 'counter_response') {
      var room = rooms[ws.roomId];
      if (!room || !room.state || !room.pendingCounter) return;
      if (room.over) return;
      var pc = room.pendingCounter;
      room.pendingCounter = null;
      var state = room.state;
      var counterCardNv = msg.counterCardNv || 0;
      var tyre = pc.tyre;
      var avsSkill = tyre.skills.find(function(s) { return s.id === 'avs'; });
      if (avsSkill && pc.atacante.alive) {
        var poderAvs = Number(avsSkill.power) || 0;
        var danoAvs = Math.max(0, tyre.curAtq + poderAvs + counterCardNv - pc.atacante.curDef);
        pc.atacante.hp -= danoAvs;
        if (pc.atacante.hp <= 0) { pc.atacante.hp = 0; pc.atacante.alive = false; }
        broadcast(room, 'counter_result', {
          charId: 'tyre', targetId: pc.atacanteId,
          targetHp: pc.atacante.hp, targetMorreu: !pc.atacante.alive, dano: danoAvs,
          state: snapshotState(state)
        });
        var winnerC = gameInit.checkWin(state);
        if (winnerC) { endGame(room, winnerC, 'battle'); return; }
      }
      if (pc.isQuickAction) {
        broadcast(room, 'next_turn', { charId: pc.atacanteId, owner: pc.attackerOwner, isQuickAction: true, state: snapshotState(state) });
      } else {
        advanceTurn(room);
      }
    }

    else if (msg.type === 'request_next_turn') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;
      var order = room.state.order;
      var idx = room.state.orderIdx || 0;
      while (idx < order.length && !order[idx]) idx++;
      if (idx >= order.length) { room.state.orderIdx = 0; idx = 0; }
      room.state.orderIdx = idx;
      var current = order[idx];
      console.log('[PATF] next_turn:', current.charId, current.owner);
      broadcast(room, 'next_turn', {
        charId: current.charId,
        owner: current.owner,
        state: snapshotState(room.state)
      });
    }

    else if (msg.type === 'skip_turn') {
      var room = rooms[ws.roomId];
      if (!room) return;
      if (room.over) return;
      console.log('[PATF] skip_turn sala:', ws.roomId, 'skipCount:', msg.skipCount);
      if (room.state && room.state.order) {
        var skOrder = room.state.order[room.state.orderIdx || 0];
        if (skOrder) {
          var skCh = room.state[skOrder.owner].chars.find(function(c) { return c.id === skOrder.charId && c.alive; });
          if (skCh) {
            if (skCh.id === 'sam') skCh._charge = Math.min(5, (skCh._charge || 0) + 1);
            if (skCh.id === 'tyre') skCh._linkAccum = Math.min(2, (skCh._linkAccum || 0) + 1);
            if (skCh.id === 'kuro') skCh._satsui = Math.min(10, (skCh._satsui || 0) + 2);
            gameInit.draw(room.state, skOrder.owner, 1);
            if (skCh.id === 'grim') { gameInit.draw(room.state, skOrder.owner, 1); broadcast(room, 'skip_passive', { charId: skCh.id, type: 'grimbol_genio' }); }
            if (skCh.id === 'kane') {
              gameInit.draw(room.state, skOrder.owner, 1);
              var kaneRoll = Math.random();
              var kaneWeapon = kaneRoll < 0.25 ? 'pistola' : kaneRoll < 0.5 ? 'metralhadora' : kaneRoll < 0.75 ? 'shotgun' : 'extra';
              if (kaneWeapon === 'extra') gameInit.draw(room.state, skOrder.owner, 1);
              if (kaneWeapon !== 'extra') {
                skCh._weapon = kaneWeapon;
                var KANE_WEAPONS = {
                  pistola:      { power: 4,         target: 'enemy',     desc: 'Critico Alto: 50% de chance de dano dobrado.' },
                  metralhadora: { power: '2/2/2/2', target: 'enemy',     desc: 'Ataque multiplo.' },
                  shotgun:      { power: 5,          target: 'all_enemy', desc: 'Ignora Armadura. Atinge todos os inimigos.' }
                };
                var wpnSk = skCh.skills.find(function(s) { return s.id === 'wpn'; });
                if (wpnSk) { wpnSk.power = KANE_WEAPONS[kaneWeapon].power; wpnSk.target = KANE_WEAPONS[kaneWeapon].target; wpnSk.desc = KANE_WEAPONS[kaneWeapon].desc; }
              }
              broadcast(room, 'skip_passive', { charId: skCh.id, type: 'kane_resgate', weapon: kaneWeapon });
            }
            if (skCh.id === 'pt_elo') {
              var PATRULHEIROS_ELO = ['pt_cae','pt_zar','pt_var','pt_tha','pt_aer'];
              var patVivos = room.state[skOrder.owner].chars.filter(function(c) { return c.id !== 'pt_elo' && c.alive && PATRULHEIROS_ELO.indexOf(c.id) !== -1; });
              if (patVivos.length > 0) { gameInit.draw(room.state, skOrder.owner, patVivos.length); broadcast(room, 'skip_passive', { charId: skCh.id, type: 'pt_elo_draw', count: patVivos.length }); }
            }
            if (skCh.id === 'gora') { skCh._agoraSerioPow = 0; }
          }
        }
        broadcast(room, 'skip_anim', { charId: skOrder.charId, owner: skOrder.owner, satsui: skCh && skCh.id === 'kuro' ? skCh._satsui : undefined });
        setTimeout(function() { advanceTurn(room); }, 1500);
      }
    }

    else if (msg.type === 'kuro_suit') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;
      var dono = ws.playerIndex === 0 ? 'p1' : 'p2';
      var kuro = room.state[dono].chars.find(function(c) { return c.id === 'kuro'; });
      if (kuro) { kuro.suit = msg.suit; }
      broadcast(room, 'kuro_suit', { suit: msg.suit });
    }

    else if (msg.type === 'gameloss') {
      var room = rooms[ws.roomId];
      if (!room) return;
      var winner = ws.playerIndex === 0 ? 'p2' : 'p1';
      console.log('[PATF] gameloss sala:', ws.roomId, 'winner:', winner);
      endGame(room, winner, 'timeout');
    }
  });

  ws.on('close', function() {
    var roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      var room = rooms[roomId];
      console.log('[PATF] Jogador desconectou:', ws.uid, 'sala:', roomId);
      if (room.state && !room.over) {
        room.disconnectTimer = setTimeout(function() {
          if (room.state && !room.over) {
            var winner = ws.playerIndex === 0 ? 'p2' : 'p1';
            endGame(room, winner, 'disconnect');
          }
        }, 30000);
      } else {
        broadcast(room, 'player_disconnected', { playerIndex: ws.playerIndex, uid: ws.uid });
      }
    }
  });
});

setInterval(function() {
  var now = Date.now();
  var timeout = 30 * 60 * 1000;
  Object.keys(rooms).forEach(function(roomId) {
    if (now - rooms[roomId].created > timeout) {
      var room = rooms[roomId];
      broadcast(room, 'room_expired', {});
      delete rooms[roomId];
      console.log('[PATF] Sala expirada:', roomId);
    }
  });
}, 5 * 60 * 1000);

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('[PATF] Servidor rodando na porta ' + PORT);
});
