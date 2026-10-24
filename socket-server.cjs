/**
 * SkillGap Arena - Socket.io Server
 * Run with: node socket-server.js
 * Then access from browser: http://<server-ip>:3001
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

// Room state: rooms[roomCode] = { players: { p1: socketId, p2: socketId }, state: {} }
const rooms = {};
const socketToRoom = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('create-room', ({ champion, playerName }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = {
      players: { p1: socket.id },
      state: {},
      createdAt: Date.now(),
    };
    socketToRoom[socket.id] = { roomCode, role: 'p1' };
    socket.join(roomCode);
    console.log('Room created:', roomCode, 'by', socket.id);
    socket.emit('room-created', { roomCode, role: 'p1', champion });
  });

  socket.on('join-room', ({ roomCode, champion, playerName }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('room-error', { message: 'Sala não encontrada' });
      return;
    }
    if (room.players.p2) {
      socket.emit('room-error', { message: 'Sala já está cheia' });
      return;
    }
    room.players.p2 = socket.id;
    socketToRoom[socket.id] = { roomCode, role: 'p2' };
    socket.join(roomCode);
    console.log('Player joined room:', roomCode, 'as p2');
    socket.emit('room-joined', { roomCode, role: 'p2', champion });
    io.to(roomCode).emit('room-full', { roomCode });
  });

  socket.on('player-input', ({ roomCode, role, input, timestamp }) => {
    const room = rooms[roomCode];
    if (!room) return;
    // Relay input to the other player
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
