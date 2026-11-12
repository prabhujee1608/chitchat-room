const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chitchat-super-secret-jwt-key-2026';
const DB_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory Database with file persistence
let db = {
  users: [],
  rooms: [],
  messages: []
};

function loadDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (db.users) return;
    } catch (e) {
      console.error('Error loading db file:', e);
    }
  }

  db = {
    users: [],
    rooms: [],
    messages: []
  };

  saveDatabase();
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save db:', err);
  }
}

loadDatabase();

// Auth Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'No token provided, authorization denied' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u._id === decoded.userId);
    if (!user) {
      return res.status(401).json({ msg: 'Token is invalid: user not found' });
    }
    req.user = { userId: user._id, username: user.username, role: user.role, email: user.email };
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Token is invalid or expired' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ msg: 'Access denied: Admin privileges required' });
  }
}

// Helpers
function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function populateUser(userId) {
  const u = db.users.find(x => x._id === userId);
  return u ? { _id: u._id, username: u.username, role: u.role, email: u.email } : { _id: userId, username: 'Unknown' };
}

// ==================== REST ROUTES ====================

// Auth: Register
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  const existingEmail = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingEmail) {
    return res.status(400).json({ msg: 'User with this email already exists' });
  }

  const existingUser = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existingUser) {
    return res.status(400).json({ msg: 'Username is already taken' });
  }

  const salt = bcrypt.genSaltSync(10);
  const newUser = {
    _id: 'user_' + crypto.randomBytes(6).toString('hex'),
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password, salt),
    role: db.users.length === 0 ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDatabase();

  const token = jwt.sign({ userId: newUser._id, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({
    token,
    user: {
      userId: newUser._id,
      username: newUser.username,
      email: newUser.email,
      role: newUser.role
    }
  });
});

// Auth: Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ msg: 'Please provide email and password' });
  }

  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(400).json({ msg: 'Invalid credentials' });
  }

  const isMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!isMatch) {
    return res.status(400).json({ msg: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role
    }
  });
});

// Auth: Me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Rooms: List
app.get('/api/rooms', authMiddleware, (req, res) => {
  const roomsWithDetails = db.rooms.map(room => {
    return {
      ...room,
      createdBy: populateUser(room.createdBy),
      users: (room.users || []).map(u => populateUser(typeof u === 'object' ? u._id : u))
    };
  });
  res.json(roomsWithDetails);
});

// Rooms: Create
app.post('/api/rooms', authMiddleware, (req, res) => {
  const { name, isPrivate } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ msg: 'Room name is required' });
  }

  let code;
  do {
    code = generateRoomCode();
  } while (db.rooms.some(r => r.roomCode === code));

  const newRoom = {
    _id: 'room_' + crypto.randomBytes(6).toString('hex'),
    name: name.trim(),
    roomCode: code,
    createdBy: req.user.userId,
    users: [req.user.userId],
    isPrivate: !!isPrivate,
    createdAt: new Date().toISOString()
  };

  db.rooms.push(newRoom);
  saveDatabase();

  const populatedRoom = {
    ...newRoom,
    createdBy: populateUser(newRoom.createdBy),
    users: [populateUser(req.user.userId)]
  };

  // Notify all connected clients of new room
  io.emit('roomCreated', populatedRoom);

  res.status(201).json(populatedRoom);
});

// Rooms: Get single
app.get('/api/rooms/:id', authMiddleware, (req, res) => {
  const room = db.rooms.find(r => r._id === req.params.id || r.roomCode === req.params.id);
  if (!room) {
    return res.status(404).json({ msg: 'Room not found' });
  }

  // Auto-add current user if not in users list
  const isMember = room.users.some(u => (typeof u === 'object' ? u._id : u) === req.user.userId);
  if (!isMember) {
    room.users.push(req.user.userId);
    saveDatabase();
  }

  res.json({
    ...room,
    createdBy: populateUser(room.createdBy),
    users: room.users.map(u => populateUser(typeof u === 'object' ? u._id : u))
  });
});

// Rooms: Join by code
app.post('/api/rooms/join', authMiddleware, (req, res) => {
  const { roomCode } = req.body;
  if (!roomCode || !roomCode.trim()) {
    return res.status(400).json({ msg: 'Room code is required' });
  }

  const room = db.rooms.find(r => r.roomCode.toUpperCase() === roomCode.trim().toUpperCase());
  if (!room) {
    return res.status(404).json({ msg: 'Invalid room code' });
  }

  const isMember = room.users.some(u => (typeof u === 'object' ? u._id : u) === req.user.userId);
  if (!isMember) {
    room.users.push(req.user.userId);
    saveDatabase();
  }

  res.json({
    ...room,
    createdBy: populateUser(room.createdBy),
    users: room.users.map(u => populateUser(typeof u === 'object' ? u._id : u))
  });
});

// Rooms: Update
app.put('/api/rooms/:id', authMiddleware, (req, res) => {
  const room = db.rooms.find(r => r._id === req.params.id);
  if (!room) return res.status(404).json({ msg: 'Room not found' });

  if (room.createdBy !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Not authorized to edit this room' });
  }

  if (req.body.name && req.body.name.trim()) {
    room.name = req.body.name.trim();
  }
  saveDatabase();

  res.json({
    ...room,
    createdBy: populateUser(room.createdBy),
    users: room.users.map(populateUser)
  });
});

// Rooms: Delete
app.delete('/api/rooms/:id', authMiddleware, (req, res) => {
  const roomIndex = db.rooms.findIndex(r => r._id === req.params.id || r.roomCode === req.params.id);
  if (roomIndex === -1) return res.status(404).json({ msg: 'Room not found' });

  const room = db.rooms[roomIndex];
  if (room.createdBy !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Not authorized to delete this room' });
  }

  // Remove messages in this room
  db.messages = db.messages.filter(m => m.roomId !== room._id);
  db.rooms.splice(roomIndex, 1);
  saveDatabase();

  res.json({ msg: 'Room deleted successfully' });
});

// Rooms: Remove user from room
app.delete('/api/rooms/:roomId/users/:userId', authMiddleware, (req, res) => {
  const room = db.rooms.find(r => r._id === req.params.roomId);
  if (!room) return res.status(404).json({ msg: 'Room not found' });

  if (room.createdBy !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Not authorized to remove members' });
  }

  room.users = room.users.filter(uId => uId !== req.params.userId);
  saveDatabase();

  res.json({ msg: 'User removed from room', users: room.users.map(populateUser) });
});

// Messages: Get for room (paginated)
app.get('/api/messages/:roomId', authMiddleware, (req, res) => {
  const { roomId } = req.params;
  const limit = parseInt(req.query.limit, 10) || 50;
  const skip = parseInt(req.query.skip, 10) || 0;

  const roomMessages = db.messages.filter(m => m.roomId === roomId);
  const total = roomMessages.length;

  const sorted = [...roomMessages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const paginated = sorted.slice(Math.max(0, sorted.length - skip - limit), sorted.length - skip);

  res.json({
    messages: paginated,
    total
  });
});

// Messages: Create
app.post('/api/messages/:roomId', authMiddleware, (req, res) => {
  const { roomId } = req.params;
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ msg: 'Message content is required' });
  }

  const room = db.rooms.find(r => r._id === roomId || r.roomCode === roomId);
  if (!room) return res.status(404).json({ msg: 'Room not found' });

  // Ensure sender is enrolled in the room
  const isMember = room.users.some(u => (typeof u === 'object' ? u._id : u) === req.user.userId);
  if (!isMember) {
    room.users.push(req.user.userId);
    saveDatabase();
  }

  const newMessage = {
    _id: 'msg_' + crypto.randomBytes(6).toString('hex'),
    roomId: room._id,
    sender: {
      _id: req.user.userId,
      username: req.user.username,
      role: req.user.role
    },
    content: content.trim(),
    reactions: {},
    deleted: false,
    createdAt: new Date().toISOString()
  };

  db.messages.push(newMessage);
  saveDatabase();

  // Instant broadcast to all clients in the room via Socket.IO
  io.to(room._id).emit('newMessage', newMessage);

  res.status(201).json(newMessage);
});

// Messages: React
app.post('/api/messages/:roomId/:messageId/reaction', authMiddleware, (req, res) => {
  const { messageId } = req.params;
  const { reaction } = req.body;
  const msg = db.messages.find(m => m._id === messageId);
  if (!msg) return res.status(404).json({ msg: 'Message not found' });

  if (!msg.reactions) msg.reactions = {};
  if (msg.reactions[req.user.userId] === reaction) {
    delete msg.reactions[req.user.userId];
  } else {
    msg.reactions[req.user.userId] = reaction;
  }
  saveDatabase();

  io.to(msg.roomId).emit('reaction', {
    messageId,
    userId: req.user.userId,
    reaction: msg.reactions[req.user.userId] || null,
    reactions: msg.reactions
  });

  res.json({ messageId, reactions: msg.reactions });
});

// Messages: Delete (soft delete)
app.delete('/api/messages/:roomId/:messageId', authMiddleware, (req, res) => {
  const { messageId } = req.params;
  const msg = db.messages.find(m => m._id === messageId);
  if (!msg) return res.status(404).json({ msg: 'Message not found' });

  const room = db.rooms.find(r => r._id === msg.roomId);
  const isOwner = room && room.createdBy === req.user.userId;
  const isAuthor = msg.sender && msg.sender._id === req.user.userId;
  const isAdmin = req.user.role === 'admin';

  if (!isAuthor && !isOwner && !isAdmin) {
    return res.status(403).json({ msg: 'Not authorized to delete this message' });
  }

  msg.deleted = true;
  saveDatabase();

  res.json({ msg: 'Message deleted', message: msg });
});

// Admin: Users list
app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.users.map(u => ({
    _id: u._id,
    username: u.username,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt
  }));
  res.json(users);
});

// Admin: Delete user
app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ msg: 'Cannot delete yourself' });
  }

  const userIndex = db.users.findIndex(u => u._id === req.params.id);
  if (userIndex === -1) return res.status(404).json({ msg: 'User not found' });

  db.users.splice(userIndex, 1);
  db.rooms.forEach(r => {
    r.users = r.users.filter(u => u !== req.params.id);
  });
  saveDatabase();

  res.json({ msg: 'User deleted' });
});

// Admin: Update user role
app.patch('/api/users/:id/role', authMiddleware, adminMiddleware, (req, res) => {
  const user = db.users.find(u => u._id === req.params.id);
  if (!user) return res.status(404).json({ msg: 'User not found' });

  user.role = req.body.role === 'admin' ? 'admin' : 'user';
  saveDatabase();

  res.json({
    _id: user._id,
    username: user.username,
    email: user.email,
    role: user.role
  });
});

// Serve frontend SPA for all unmatched routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ==================== SOCKET.IO ====================

const socketToUser = new Map();
const userSockets = new Map();
const roomActiveUsers = new Map();

function getOnlineUserIds() {
  return Array.from(userSockets.keys());
}

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('storeUserId', ({ userId }) => {
    if (!userId) return;
    socketToUser.set(socket.id, userId);

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    io.emit('userList', getOnlineUserIds());
  });

  socket.on('joinRoom', ({ roomId, userId }) => {
    if (!roomId || !userId) return;
    const room = db.rooms.find(r => r._id === roomId || r.roomCode === roomId);
    const actualId = room ? room._id : roomId;

    socket.join(actualId);
    if (room && room.roomCode) {
      socket.join(room.roomCode);
    }

    if (!roomActiveUsers.has(actualId)) {
      roomActiveUsers.set(actualId, new Set());
    }
    roomActiveUsers.get(actualId).add(userId);

    const user = populateUser(userId);
    socket.to(actualId).emit('userJoined', {
      userId: user._id,
      username: user.username
    });

    io.to(actualId).emit('userList', getOnlineUserIds());
  });

  socket.on('leaveRoom', ({ roomId, userId }) => {
    if (!roomId || !userId) return;
    const room = db.rooms.find(r => r._id === roomId || r.roomCode === roomId);
    const actualId = room ? room._id : roomId;

    socket.leave(actualId);
    if (room && room.roomCode) {
      socket.leave(room.roomCode);
    }

    if (roomActiveUsers.has(actualId)) {
      roomActiveUsers.get(actualId).delete(userId);
    }

    const user = populateUser(userId);
    socket.to(actualId).emit('userLeft', {
      userId: user._id,
      username: user.username
    });
  });

  socket.on('broadcastMessage', ({ roomId, message }) => {
    if (!roomId || !message) return;
    socket.to(roomId).emit('newMessage', message);
  });

  socket.on('typing', ({ roomId, userId }) => {
    if (!roomId || !userId) return;
    const user = populateUser(userId);
    socket.to(roomId).emit('typing', {
      userId: user._id,
      username: user.username
    });
  });

  socket.on('stopTyping', ({ roomId, userId }) => {
    if (!roomId || !userId) return;
    socket.to(roomId).emit('stopTyping', { userId });
  });

  socket.on('reaction', ({ messageId, userId, reaction }) => {
    const msg = db.messages.find(m => m._id === messageId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    if (msg.reactions[userId] === reaction) {
      delete msg.reactions[userId];
    } else {
      msg.reactions[userId] = reaction;
    }
    saveDatabase();

    io.to(msg.roomId).emit('reaction', {
      messageId,
      userId,
      reaction: msg.reactions[userId] || null,
      reactions: msg.reactions
    });
  });

  socket.on('roomUpdated', ({ roomId, roomData }) => {
    io.to(roomId).emit('roomUpdated', roomData);
  });

  socket.on('removeUser', ({ roomId, userId }) => {
    io.to(roomId).emit('userRemoved', { userId });
  });

  socket.on('disconnect', () => {
    const userId = socketToUser.get(socket.id);
    socketToUser.delete(socket.id);

    if (userId && userSockets.has(userId)) {
      const set = userSockets.get(userId);
      set.delete(socket.id);
      if (set.size === 0) {
        userSockets.delete(userId);
        for (const [roomId, members] of roomActiveUsers.entries()) {
          if (members.has(userId)) {
            members.delete(userId);
            const user = populateUser(userId);
            socket.to(roomId).emit('userLeft', { userId, username: user.username });
          }
        }
      }
    }

    io.emit('userList', getOnlineUserIds());
    console.log('Socket disconnected:', socket.id);
  });
});

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 ChitChat Server listening on http://localhost:${PORT}`);
    console.log(`📡 Socket.IO real-time engine ready`);
    console.log(`🔒 Authentication Required: Register or Login to enter`);
    console.log(`===============================================`);
  });
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;
