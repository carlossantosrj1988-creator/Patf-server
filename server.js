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
function advanceTurn(room) {
  var state = room.state;
  state.orderIdx = (state.orderIdx || 0) + 1;
  if (state.orderIdx >= state.order.length) state.orderIdx = 0;
  var current = state.order[state.orderIdx];
  var charId = current.charId;
  var owner = current.owner;

  // Busca o personagem no state
  var ch = state[owner].chars.find(function(c) { return c.id === charId; });

  // Pula mortos
  if (ch && !ch.alive) {
    advanceTurn(room);
    return;
  }
  
// Checa Frozen/Stun — 50% de perder o turno
  if (ch) {
    var hasFrozen = ch.statuses.find(function(s) { return s.id === 'frozen'; });
    var hasStun   = ch.statuses.find(function(s) { return s.id === 'stun'; });
    if ((hasFrozen || hasStun) && Math.random() < 0.5) {
      broadcast(room, 'turn_skipped', {
        charId: charId,
        owner: owner,
        reason: hasFrozen ? 'frozen' : 'stun'
      });
      advanceTurn(room);
      return;
    }
  }
  
  // Aplica DoTs antes do turno
  var dotEffects = [];
  if (ch) {
    dotEffects = gameInit.applyDoTs(ch);
  }

  // Se teve DoTs, manda pro cliente
  if (dotEffects.length > 0) {
    broadcast(room, 'turn_effects', {
      charId: charId,
      owner: owner,
      effects: dotEffects,
      hp: ch.hp,
      alive: ch.alive
    });

    // Morreu pelo DoT — checa vitória e avança
    if (!ch.alive) {
      var winner = gameInit.checkWin(state);
      if (winner) {
        broadcast(room, 'game_over', { winner: winner, reason: 'dot' });
        return;
      }
      advanceTurn(room);
      return;
    }
  }

  // Manda o turno
  broadcast(room, 'next_turn', {
    charId: charId,
    owner: owner
  });
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
        console.log('[PATF] Reconexao:', uid, 'sala:', roomId);
        send(ws, 'joined', {
          roomId: roomId,
          playerIndex: existingIndex,
          players: room.uids.length,
          reconnected: true
        });
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

        broadcast(room, 'initiative_result', {
          order: all
        });
      }
    }

    else if (msg.type === 'action') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;

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

      var skill = atacante ? atacante.skills.find(function(s) {
        return s.id === skillId;
      }) : null;

      var alvo = state[inimigo].chars.find(function(c) {
        return c.id === alvoId && c.alive;
      });

      if (!atacante || !skill || !alvo) {
        return send(ws, 'error', { message: 'Acao invalida' });
      }

      // ── ALL_ALLY: skill de suporte nos aliados ──
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
            statusApplied: efeitoAlly, isAlly: true
          });
        });
        advanceTurn(room);
        return;
      }
      
      // ── ÁREA: múltiplos alvos ──
      if (msg.isArea && msg.targetIds && msg.targetIds.length > 0) {
        var alvosArea = msg.targetIds.map(function(tid) {
          return state[inimigo].chars.find(function(c) { return c.id === tid && c.alive; });
        }).filter(Boolean);

        if (alvosArea.length === 0) return;

        room.pendingAreaAction = {
          atacanteId: atacanteId,
          skillId: skillId,
          skillName: skill.name,
          poder: skill.power,
          atkCardNv: atkCardNv,
          atkCardSuit: atkCardSuit,
          atacante: atacante,
          attackerOwner: dono,
          alvos: alvosArea,
          areaIdx: 0,
          areaTotal: alvosArea.length,
          resultados: []
        };

        var defAreaWs = room.players[inimigo === 'p1' ? 0 : 1];
        send(defAreaWs, 'defense_request', {
          atacante: atacanteId,
          alvo: alvosArea[0].id,
          skillId: skillId,
          skillName: skill.name,
          poder: skill.power,
          atkCardNv: atkCardNv,
          atkCardSuit: atkCardSuit,
          attackerOwner: dono,
          isArea: true,
          areaCurrent: 1,
          areaTotal: alvosArea.length
        });
        return;
      }
      
      // Melt/Catastrófico — bloqueia painel de defesa
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
          statusApplied: stMelt, melt: true
        });
        var winnerMelt = gameInit.checkWin(state);
        if (winnerMelt) { broadcast(room, 'game_over', { winner: winnerMelt, reason: 'battle' }); return; }
        advanceTurn(room);
        return;
      }
      
      // Guarda ataque pendente aguardando defesa
      room.pendingAction = {
        atacanteId: atacanteId,
        skillId: skillId,
        skillName: skill.name,
        poder: skill.power,
        alvoId: alvoId,
        atkCardNv: atkCardNv,
        atkCardSuit: atkCardSuit,
        atacante: atacante,
        alvo: alvo,
        attackerOwner: dono
      };

      // Pede defesa ao defensor
      var defensorWs = room.players[inimigo === 'p1' ? 0 : 1];
      send(defensorWs, 'defense_request', {
        atacante: atacanteId,
        alvo: alvoId,
        skillId: skillId,
        skillName: skill.name,
        poder: skill.power,
        atkCardNv: atkCardNv,
        atkCardSuit: atkCardSuit,
        attackerOwner: dono
      });
    }

    else if (msg.type === 'defense_response') {
      var room = rooms[ws.roomId];
   if (!room || !room.state) return;
      if (!room.pendingAction && !room.pendingAreaAction) return;

      // ── RESPOSTA DE ÁREA ──
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
          // ── Fase 8c: Crítico e dano condicional (área) ──
          var criticoArea = false;
          if (paa.skillId === 'wpn' && Math.random() < 0.5) {
            poderAreaTotal = poderAreaTotal * 2;
            criticoArea = true;
          }
          if (paa.skillId === 'web') {
            var temLentoA = alvoAtual.statuses.find(function(s) { return s.id === 'slow'; });
            if (temLentoA) { poderAreaTotal = poderAreaTotal * 2; criticoArea = true; }
          }
          if (paa.skillId === 'uni') {
            var temCondA = alvoAtual.statuses.find(function(s) { return s.id === 'exposed' || s.id === 'weak'; });
            if (temCondA) { poderAreaTotal = poderAreaTotal * 2; criticoArea = true; }
          }
          if (paa.skillId === 'eli2') {
            var idxExpA = alvoAtual.statuses.findIndex(function(s) { return s.id === 'exposed'; });
            if (idxExpA !== -1) {
              alvoAtual.statuses.splice(idxExpA, 1);
              alvoAtual.curDef = alvoAtual.def;
              poderAreaTotal = poderAreaTotal * 2;
              criticoArea = true;
            }
          }
          if (paa.skillId === 'tcz') {
            var debuffsA = ['burn','bleed','rad','static','chill','frozen','stun','exposed','weak','amaciado','melt','slow'];
            var countDebuffsA = alvoAtual.statuses.filter(function(s) { return debuffsA.indexOf(s.id) !== -1; }).length;
            poderAreaTotal = poderAreaTotal + (3 * countDebuffsA);
          }
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
            esquivou: r.esquivou, statusApplied: r.statusApplied || [], isArea: true
          });
        });

        room.pendingAreaAction = null;
        var winnerArea = gameInit.checkWin(room.state);
        if (winnerArea) { broadcast(room, 'game_over', { winner: winnerArea, reason: 'battle' }); return; }
        advanceTurn(room);
        return;
      }
      var state = room.state;
      var pa = room.pendingAction;
      room.pendingAction = null;

      var defCardNv = msg.defCardNv || 0;
      var isJack = msg.isJack || false;

      var atacante = pa.atacante;
      var alvo = pa.alvo;

      // Valete — esquiva total
      if (isJack) {
        broadcast(room, 'action_result', {
          atacante: pa.atacanteId,
          skill: pa.skillId,
          alvo: pa.alvoId,
          dano: 0,
          hpAlvo: alvo.hp,
          morreu: false,
          esquivou: true
        });
        // Avança turno após esquiva
        advanceTurn(room);
      } else {
        // Trata poder multi-hit (ex: '2/2' ou '1/1/1')
var poderTotal = pa.poder;
if (typeof pa.poder === 'string' && pa.poder.indexOf('/') !== -1) {
  poderTotal = pa.poder.split('/').reduce(function(acc, v) { return acc + Number(v); }, 0);
}
        // Calcula dano com defesa
        var ignoreArmor = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
ignoreArmor = ignoreArmor && (ignoreArmor.desc.includes('Ignora Armadura') || ignoreArmor.desc.includes('Catastrofico'));
var defTotal = ignoreArmor ? 0 : (alvo.def + defCardNv);
        // ── Fase 8c: Crítico e dano condicional ──
        var critico = false;
        if (pa.skillId === 'wpn' && Math.random() < 0.5) {
          poderTotal = poderTotal * 2;
          critico = true;
        }
        if (pa.skillId === 'web') {
          var temLento = alvo.statuses.find(function(s) { return s.id === 'slow'; });
          if (temLento) { poderTotal = poderTotal * 2; critico = true; }
        }
        if (pa.skillId === 'uni') {
          var temCond = alvo.statuses.find(function(s) { return s.id === 'exposed' || s.id === 'weak'; });
          if (temCond) { poderTotal = poderTotal * 2; critico = true; }
        }
        if (pa.skillId === 'eli2') {
          var idxExp = alvo.statuses.findIndex(function(s) { return s.id === 'exposed'; });
          if (idxExp !== -1) {
            alvo.statuses.splice(idxExp, 1);
            alvo.curDef = alvo.def;
            poderTotal = poderTotal * 2;
            critico = true;
          }
        }
        if (pa.skillId === 'tcz') {
          var debuffs = ['burn','bleed','rad','static','chill','frozen','stun','exposed','weak','amaciado','melt','slow'];
          var countDebuffs = alvo.statuses.filter(function(s) { return debuffs.indexOf(s.id) !== -1; }).length;
          poderTotal = poderTotal + (3 * countDebuffs);
        }
        // ── Fase 8d: Acúmulo de cargas ──
        if (pa.skillId === 'fpl' || pa.skillId === 'ffr') {
          var cargas = atacante._charge || 0;
          poderTotal = cargas;
          if (cargas >= 5) { msg.isArea = true; }
          atacante._charge = 0;
        }
        if (pa.skillId === 'aes') {
          var accum = atacante._linkAccum || 0;
          if (accum >= 2) { pa.isAreaOverride = true; }
          else if (accum >= 1) { pa.ignoreArmorOverride = true; }
          atacante._linkAccum = 0;
        }
        if (pa.skillId === 'had') {
          var satsui = atacante._satsui || 0;
          poderTotal = 5 + (satsui * 2);
          atacante._satsui = 0;
        }
        var dano = gameInit.resolveAttack(atacante.atq + pa.atkCardNv, poderTotal, defTotal);

        alvo.hp -= dano;
        if (alvo.hp <= 0) {
          alvo.hp = 0;
          alvo.alive = false;
        }
        // Aplica status da skill no alvo
        var skill = pa.atacante.skills.find(function(s) { return s.id === pa.skillId; });
        var statusApplied = [];
        if (skill) {
          statusApplied = gameInit.applySkillEffects(skill, alvo);
        }

        broadcast(room, 'action_result', {
          atacante: pa.atacanteId,
          skill: pa.skillId,
          alvo: pa.alvoId,
          dano: dano,
          hpAlvo: alvo.hp,
          morreu: !alvo.alive,
         statusApplied: statusApplied,
          critico: critico
        });

        // Verifica vitória
        var winner = gameInit.checkWin(state);
        if (winner) {
          broadcast(room, 'game_over', { winner: winner, reason: 'battle' });
          return;
        }
      // Avança turno após o dano
        advanceTurn(room);
      }
    }

    else if (msg.type === 'request_next_turn') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;

      var order = room.state.order;
      var idx = room.state.orderIdx || 0;

      while (idx < order.length && !order[idx]) idx++;
      if (idx >= order.length) {
        room.state.orderIdx = 0;
        idx = 0;
      }

      room.state.orderIdx = idx;
      var current = order[idx];

      console.log('[PATF] next_turn:', current.charId, current.owner);
      broadcast(room, 'next_turn', {
        charId: current.charId,
        owner: current.owner
      });
    }

    else if (msg.type === 'skip_turn') {
      var room = rooms[ws.roomId];
      if (!room) return;
      console.log('[PATF] skip_turn sala:', ws.roomId, 'skipCount:', msg.skipCount);
      if (room.state && room.state.order) {
        var skOrder = room.state.order[room.state.orderIdx || 0];
        if (skOrder) {
          var skCh = room.state[skOrder.owner].chars.find(function(c) { return c.id === skOrder.charId && c.alive; });
          if (skCh) {
            if (skCh.id === 'sam') skCh._charge = Math.min(5, (skCh._charge || 0) + 1);
            if (skCh.id === 'tyre') skCh._linkAccum = Math.min(2, (skCh._linkAccum || 0) + 1);
            if (skCh.id === 'kuro') skCh._satsui = Math.min(10, (skCh._satsui || 0) + 2);
          }
        }
        advanceTurn(room);
      }
    }

    else if (msg.type === 'gameloss') {
      var room = rooms[ws.roomId];
      if (!room) return;
      var winner = ws.playerIndex === 0 ? 'p2' : 'p1';
      console.log('[PATF] gameloss sala:', ws.roomId, 'winner:', winner);
      broadcast(room, 'game_over', { winner: winner, reason: 'timeout' });
    }

  });

  ws.on('close', function() {
    var roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      var room = rooms[roomId];
      console.log('[PATF] Jogador desconectou:', ws.uid, 'sala:', roomId);
      broadcast(room, 'player_disconnected', {
        playerIndex: ws.playerIndex,
        uid: ws.uid
      });
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
