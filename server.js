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

      var state = gameInit.initBattle(msg.p1Ids, msg.p2Ids);
      if (state.error) return send(ws, 'error', { message: state.error });

      room.state = state;
      console.log('[PATF] Batalha iniciada sala:', ws.roomId);

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

        console.log('[PATF] Ordem definida:', all.map(function(a) { return a.charId; }).join(' > '));
        broadcast(room, 'initiative_result', { order: all });
      }
    }

    else if (msg.type === 'request_next_turn') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;
      if (ws.playerIndex !== 0) return;

      var order = room.state.order;
      var idx = room.state.orderIdx || 0;

      while (idx < order.length && !order[idx]) idx++;
      if (idx >= order.length) { room.state.orderIdx = 0; idx = 0; }

      room.state.orderIdx = idx;
      var current = order[idx];

      console.log('[PATF] next_turn:', current.charId, current.owner);
      broadcast(room, 'next_turn', { charId: current.charId, owner: current.owner });
    }

    else if (msg.type === 'action') {
      var room = rooms[ws.roomId];
      if (!room || !room.state) return;

      var attackerOwner = ws.playerIndex === 0 ? 'p1' : 'p2';
      var defenderOwner = attackerOwner === 'p1' ? 'p2' : 'p1';

      var attacker = room.state[attackerOwner].chars.find(function(c) {
        return c.id === msg.charId && c.alive;
      });
      var target = room.state[defenderOwner].chars.find(function(c) {
        return c.id === msg.targetId && c.alive;
      });

      if (!attacker || !target) {
        console.log('[PATF] action invalida — atacante ou alvo nao encontrado');
        return;
      }

      var sk = attacker.skills ? attacker.skills.find(function(s) { return s.id === msg.skillId; }) : null;
      var poder = sk ? (sk.power || 0) : 0;
      var atkCardNv = msg.atkCardNv || 0;

      var dano = gameInit.resolveAttack(
  (attacker.curAtq || attacker.atq) + atkCardNv,
  poder,
  target.curDef || target.def
);

      target.hp -= dano;
      var morreu = target.hp <= 0;
      if (morreu) { target.hp = 0; target.alive = false; }

      console.log('[PATF] action:', attacker.name, '->', target.name, 'dano:', dano, 'hp:', target.hp);

      broadcast(room, 'action_result', {
        atacante: attacker.id,
        alvo: target.id,
        dano: dano,
        hpAlvo: target.hp,
        morreu: morreu
      });

      var order = room.state.order;
      var idx = (room.state.orderIdx || 0) + 1;
      if (idx >= order.length) idx = 0;
      room.state.orderIdx = idx;
      var next = order[idx];
      if (next) {
        console.log('[PATF] next_turn apos action:', next.charId, next.owner);
        broadcast(room, 'next_turn', { charId: next.charId, owner: next.owner });
      }
    }

    else if (msg.type === 'skip_turn') {
      var room = rooms[ws.roomId];
      if (!room || !room.state || !room.state.order) return;
      console.log('[PATF] skip_turn sala:', ws.roomId);

      room.state.orderIdx = (room.state.orderIdx || 0) + 1;
      if (room.state.orderIdx >= room.state.order.length) room.state.orderIdx = 0;
      var next = room.state.order[room.state.orderIdx];
      broadcast(room, 'next_turn', { charId: next.charId, owner: next.owner });
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
      broadcast(rooms[roomId], 'room_expired', {});
      delete rooms[roomId];
      console.log('[PATF] Sala expirada:', roomId);
    }
  });
}, 5 * 60 * 1000);

var PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('[PATF] Servidor rodando na porta ' + PORT);
});
