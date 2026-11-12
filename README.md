# ChitChat - Real-time Messaging Web App

A high-performance real-time chat web application inspired by **[ChitChat](https://chataditya.vercel.app/)**, featuring a Cyber-Night theme, glassmorphism design, instant WebSockets messaging, live typing indicators, emoji reactions, and full room and user administration.

---

## 🌟 Key Features

1. **Cyber-Night Theme & Glassmorphism**:
   - Animated flowing gradient background (`#0f0f23`, `#1a1a2e`, `#16213e`, `#0f3460`).
   - Glowing blur ambient orbs.
   - Frosted glass cards, translucent inputs, and gradient buttons.

2. **Real-Time Communication (Socket.IO)**:
   - Instant message transmission and room broadcasting.
   - Live 3-dot bouncing typing indicator ("*Aditya is typing...*").
   - Live user presence (Active participant count, Online 🟢 / Offline ⚪ indicators).
   - Message reactions (❤️ Heart, 👍 Thumbs Up, 😊 Smile) with live counters.
   - Real-time room events (user joined, user left, room renamed, member kicked).
   - Audio chime notifications on new incoming messages using the Web Audio API.

3. **Room Management**:
   - Create public or private rooms with automated unique 6-character room codes.
   - **My Rooms**, **Joined Rooms**, and **Available Lounges** sections.
   - 1-click room code copying to clipboard with interactive feedback.
   - Room link sharing via the native Web Share API with fallback.
   - Join room modal via 6-character room code.
   - Slide-out Room Info Sidebar Drawer (edit room name, list members, remove users).

4. **Strict Authentication & Role Elevation**:
   - Visitors must log in or create an account to enter the website.
   - The first account registered automatically receives the **`admin`** role.
   - Subsequent registrations become standard users.
   - Full JWT session management with secure password hashing via `bcryptjs`.

5. **Full Admin Dashboard**:
   - Stat metric counters: Total Rooms, Total Users, Admins, Regular Users.
   - Room moderation: view all rooms, join any room, delete rooms.
   - User moderation: view all users, promote to Admin or demote to Regular, delete user accounts.

6. **Rich Categorized Emoji Picker**:
   - Categories: Recent, Smileys, Hearts, Gestures, Nature, Food, Activities, Objects.
   - Live emoji search bar.
   - Remembers recently used emojis in `localStorage`.

---

## 🚀 Running the App

```bash
# Start the server (serves both API, WebSockets, and Frontend)
npm start
```

Visit in your browser:
**[http://localhost:3000](http://localhost:3000)**

---

## 📂 Project Architecture

```
real time chat app/
├── package.json          # Project configuration & dependencies
├── README.md             # Documentation
├── server/
│   ├── server.js         # Express + Socket.IO + In-memory DB with persistence
│   └── data.json         # Persistent database file (rooms, users, messages)
└── public/
    ├── index.html        # Main HTML shell with Tailwind & Socket.IO client
    ├── style.css         # Cyber-Night theme, glassmorphism, animations
    └── app.js            # Frontend SPA logic, routing, real-time handlers
```

