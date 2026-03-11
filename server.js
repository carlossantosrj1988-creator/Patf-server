const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

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
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return send(ws, 'error', { message: 'JSON invalido' });
    }

    if (msg.type === 'create_room') {
      const roomId = generateRoomId();
      rooms[roomId] = {
        players: [ws],
        state: {},
        created: Date.now()
      };
      ws.roomId = roomId;
      ws.playerIndex = 0;
      console.log('[PATF] Sala criada:', roomId);
      send(ws, 'room_created', { roomId: roomId });
    }

    else if (msg.type === 'join_room') {
      const roomId = msg.roomId;
      const room = rooms[roomId];
      if (!room) {
        return send(ws, 'error', { message: 'Sala nao encontrada' });
      }
      if (room.players.length >= 2) {
        return send(ws, 'error', { message: 'Sala cheia' });
      }
      room.players.push(ws);
      ws.roomId = roomId;
      ws.playerIndex = 1;
      console.log('[PATF] Jogador entrou na sala:', roomId);
      broadcast(room, 'room_ready', {
        roomId: roomId,
        players: 2
      });
    }

    else if (msg.type === 'action') {
      const room = rooms[ws.roomId];
      if (!room) return;
      const result = processAction(room, ws.playerIndex, msg.action);
      broadcast(room, 'action_result', {
        playerIndex: ws.playerIndex,
        action: msg.action,
        result: result
      });
    }

    else if (msg.type === 'select_character') {
      const room = rooms[ws.roomId];
      if (!room) return;
      broadcast(room, 'character_selected', {
        playerIndex: ws.playerIndex,
        character: msg.character
      });
    }
  });

  ws.on('close', function() {
    const roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      broadcast(room, 'player_disconnected', {
        playerIndex: ws.playerIndex
      });
      delete rooms[roomId];
      console.log('[PATF] Sala removida:', roomId);
    }
  });
});

function processAction(room, playerIndex, action) {
  const result = {
    success: true,
    timestamp: Date.now()
  };
  if (action.needsRandom) {
    result.randomValue = Math.random();
    result.randomResult = result.randomValue < (action.chance || 0.5);
  }
  if (action.type === 'attack' || action.type === 'skill') {
    result.damage = action.baseDamage || 0;
  }
  return result;
}

setInterval(function() {
  const now = Date.now();
  const timeout = 30 * 60 * 1000;
  Object.keys(rooms).forEach(function(roomId) {
    if (now - rooms[roomId].created > timeout) {
      broadcast(rooms[roomId], 'room_expired', {});
      delete rooms[roomId];
      console.log('[PATF] Sala expirada:', roomId);
    }
  });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
  console.log('[PATF] Servidor rodando na porta ' + PORT);
});
