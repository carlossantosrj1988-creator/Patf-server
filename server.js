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

    else if (msg.type === 'action') {
      var room = rooms[ws.roomId];
      if (!room) return;
      broadcast(room, 'action_result', {
        playerIndex: ws.playerIndex,
        action: msg.action,
        timestamp: Date.now()
      });
    }
    else if (msg.type === 'start_battle') {
  var room = rooms[ws.roomId];
  if (!room) return;

  // Só o host (playerIndex 0) inicia a batalha
  if (ws.playerIndex !== 0) return;

  var p1Ids = msg.p1Ids;
  var p2Ids = msg.p2Ids;

  // Juiz monta o estado completo da batalha
  var state = gameInit.initBattle(p1Ids, p2Ids);

  if (state.error) {
    return send(ws, 'error', { message: state.error });
  }

  // Guarda o estado na sala
  room.state = state;

  // Avisa os dois jogadores
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
