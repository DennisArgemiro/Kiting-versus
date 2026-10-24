/**
 * SkillGap Arena - Socket.io Server
 * Run with: node socket-server.cjs
 */

const { createServer } = require('http');
const { Server } = require('socket.io');

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3002;

// Matchmaking queue
const matchQueue = []; // { socketId, champion, joinedAt }

// Room state: rooms[roomCode] = { players: { p1: socketId, p2: socketId }, state: {} }
const rooms = {};
const socketToRoom = {};

function matchPlayers() {
  if (matchQueue.length < 2) return;
  const p1 = matchQueue.shift();
  const p2 = matchQueue.shift();
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  rooms[roomCode] = {
    players: { p1: p1.socketId, p2: p2.socketId },
    state: {},
    createdAt: Date.now(),
  };
  socketToRoom[p1.socketId] = { roomCode, role: 'p1' };
  socketToRoom[p2.socketId] = { roomCode, role: 'p2' };
  p1.socketId.join(roomCode);
  p2.socketId.join(roomCode);
  console.log('Match found:', roomCode, p1.socketId, 'vs', p2.socketId);
  io.to(p1.socketId).emit('match-found', { roomCode, role: 'p1', opponentChampion: p2.champion });
  io.to(p2.socketId).emit('match-found', { roomCode, role: 'p2', opponentChampion: p1.champion });
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('find-match', ({ champion }) => {
    // Remove any existing queue entry for this socket
    const idx = matchQueue.findIndex(q => q.socketId === socket.id);
    if (idx >= 0) matchQueue.splice(idx, 1);
    matchQueue.push({ socketId: socket.id, champion, joinedAt: Date.now() });
    console.log('Player queued:', socket.id, 'champion:', champion, 'queue size:', matchQueue.length);
    matchPlayers();
  });

  socket.on('player-input', ({ roomCode, role, input, timestamp }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const otherRole = role === 'p1' ? 'p2' : 'p1';
    const otherSocketId = room.players[otherRole];
    if (otherSocketId) {
      io.to(otherSocketId).emit('opponent-input', { role, input, timestamp });
    }
  });

  socket.on('game-event', ({ roomCode, role, event, data }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const otherRole = role === 'p1' ? 'p2' : 'p1';
    const otherSocketId = room.players[otherRole];
    if (otherSocketId) {
      io.to(otherSocketId).emit('opponent-event', { role, event, data });
    }
  });

  socket.on('disconnect', () => {
    // Remove from queue
    const idx = matchQueue.findIndex(q => q.socketId === socket.id);
    if (idx >= 0) matchQueue.splice(idx, 1);
    
    const info = socketToRoom[socket.id];
    if (info) {
      const room = rooms[info.roomCode];
      if (room) {
        const otherRole = info.role === 'p1' ? 'p2' : 'p1';
        const otherSocketId = room.players[otherRole];
        if (otherSocketId) {
          io.to(otherSocketId).emit('opponent-disconnected');
        }
        delete rooms[info.roomCode];
      }
      delete socketToRoom[socket.id];
    }
    console.log('Player disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log('SkillGap Arena Server listening on port', PORT);
});
