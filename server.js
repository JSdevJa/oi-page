// === server.js ===
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

const bannedIPs = new Set();
const activeIPs = new Map();

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
}

app.use((req, res, next) => {
  const ip = getIP(req);
  if (bannedIPs.has(ip) && req.path !== '/Ban.html') {
    return res.redirect('/Ban.html');
  }
  next();
});

app.use(express.static('public'));
app.use(express.json());

app.post('/ban-ip', (req, res) => {
  const ip = getIP(req);
  bannedIPs.add(ip);
  console.log(Banned IP: ${ip});
  res.sendStatus(200);
});

app.get('/check-ip-ban', (req, res) => {
  const ip = getIP(req);
  res.json({ banned: bannedIPs.has(ip) });
});

const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1600;
const PLAYER_SIZE = 40;

const players = {};

function getRandomSpawn() {
  return {
    x: Math.floor(Math.random() * (MAP_WIDTH - PLAYER_SIZE)),
    y: Math.floor(Math.random() * (MAP_HEIGHT - PLAYER_SIZE)),
  };
}

function getRandomColor() {
  const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];
  return colors[Math.floor(Math.random() * colors.length)];
}

io.on('connection', (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address;

  if (bannedIPs.has(ip)) {
    socket.emit('banned', 'You are banned.');
    socket.disconnect(true);
    return;
  }

  if (activeIPs.has(ip)) {
    bannedIPs.add(ip);
    socket.emit('banned', 'Duplicate IP detected. You are banned.');
    socket.disconnect(true);
    return;
  }

  activeIPs.set(ip, socket.id);
  console.log(Player connected: ${socket.id} | IP: ${ip});

  socket.on('registerName', (name) => {
    name = name.trim();
    if (!name) {
      socket.emit('nameRejected', 'Name cannot be empty');
      return;
    }

    for (const id in players) {
      if (players[id].name.toLowerCase() === name.toLowerCase()) {
        socket.emit('nameRejected', 'Name already taken');
        return;
      }
    }

    const spawn = getRandomSpawn();
    players[socket.id] = {
      id: socket.id,
      name,
      x: spawn.x,
      y: spawn.y,
      color: getRandomColor(),
      size: PLAYER_SIZE,
      ip,
      health: 100,
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);
  });

  socket.on('playerMovement', (pos) => {
    if (players[socket.id]) {
      players[socket.id].x = pos.x;
      players[socket.id].y = pos.y;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('chatMessage', (msg) => {
    if (players[socket.id]) {
      const name = players[socket.id].name;
      io.emit('chatMessage', { name, message: msg });
    }
  });

  socket.on('shoot', (dir) => {
    const shooter = players[socket.id];
    if (!shooter) return;

    const bullet = {
      id: ${socket.id}-${Date.now()},
      x: shooter.x + PLAYER_SIZE / 2,
      y: shooter.y + PLAYER_SIZE / 2,
      vx: dir.vx * 10,
      vy: dir.vy * 10,
      shooterId: socket.id,
    };

    io.emit('spawnBullet', bullet);

    const interval = setInterval(() => {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;

      if (bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_WIDTH || bullet.y > MAP_HEIGHT) {
        clearInterval(interval);
        io.emit('removeBullet', bullet.id);
        return;
      }

      for (const id in players) {
        if (id === bullet.shooterId) continue;
        const target = players[id];
        if (
          bullet.x > target.x &&
          bullet.x < target.x + PLAYER_SIZE &&
          bullet.y > target.y &&
          bullet.y < target.y + PLAYER_SIZE
        ) {
          target.health -= 20;
          if (target.health <= 0) {
            io.emit('playerKilled', { id: target.id, by: shooter.name });
            target.health = 100;
            const respawn = getRandomSpawn();
            target.x = respawn.x;
            target.y = respawn.y;
          } else {
            io.emit('playerDamaged', { id: target.id, health: target.health });
          }
          io.emit('removeBullet', bullet.id);
          clearInterval(interval);
          return;
        }
      }
    }, 50);
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      const ip = players[socket.id].ip;
      if (ip && activeIPs.get(ip) === socket.id) {
        activeIPs.delete(ip);
      }

      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(Server running at http://localhost:${PORT});
})