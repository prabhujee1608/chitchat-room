// ChitChat - Real-time Messaging Web Application
// Inspired by chataditya.vercel.app with complete real-time features

(function() {
  // App State
  const state = {
    user: null,
    token: localStorage.getItem('token') || null,
    view: localStorage.getItem('token') ? 'home' : 'login', // 'home', 'login', 'register', 'chat', 'admin'
    currentRoomId: null,
    currentRoom: null,
    rooms: [],
    messages: [],
    totalMessages: 0,
    typingUsers: [],
    onlineUsers: [],
    isSidebarOpen: false,
    isJoinModalOpen: false,
    joinModalRoom: null,
    isEmojiPickerOpen: false,
    selectedEmojiCategory: 'smileys',
    emojiSearch: '',
    recentEmojis: JSON.parse(localStorage.getItem('recentEmojis') || '["❤️", "👍", "🔥", "😊", "🎉", "🚀"]'),
    adminTab: 'rooms',
    usersList: [],
    isConnected: false,
    hasUnreadMessages: 0,
    activeProfileMenu: false,
    isSoundEnabled: true,
  };

  let socket = null;
  let typingTimeout = null;

  // Sound generator using Web Audio API
  function playChime() {
    if (!state.isSoundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (e) {}
  }

  // Toast notification system
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const colorClass = type === 'error'
      ? 'bg-red-500/20 text-red-300 border-red-500/40'
      : type === 'info'
      ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
      : 'bg-green-500/20 text-green-300 border-green-500/40';

    toast.className = `${colorClass} pointer-events-auto backdrop-blur-xl border px-4 py-2.5 rounded-xl shadow-2xl text-sm flex items-center gap-2 animate-slide-up transition-all duration-300`;
    toast.innerHTML = `
      <span class="w-2 h-2 rounded-full ${type === 'error' ? 'bg-red-400' : type === 'info' ? 'bg-blue-400' : 'bg-green-400'} animate-pulse"></span>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // Dynamic API Base URL (auto-connects to port 3000 if frontend is served via Live Server on port 5500/5173)
  const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (window.location.port && window.location.port !== '3000' ? 'http://localhost:3000' : '')
    : '';

  // API Client
  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    const url = path.startsWith('http') ? path : (API_BASE + path);

    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.msg || data.message || `Request failed (${res.status})`);
      }
      return data;
    } catch (err) {
      throw err;
    }
  }

  // Helpers
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  // Socket.IO Setup
  function initSocket() {
    if (socket) return;
    if (typeof io === 'undefined') return;

    try {
      socket = io(API_BASE || undefined, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        timeout: 10000
      });
    } catch (e) {
      console.warn('Socket initialization failed:', e);
      return;
    }

    socket.on('connect', () => {
      state.isConnected = true;
      if (state.user && state.user.userId) {
        socket.emit('storeUserId', { userId: state.user.userId });
      }
      if (state.currentRoomId && state.user) {
        socket.emit('joinRoom', { roomId: state.currentRoomId, userId: state.user.userId });
      }
      updateNavbar();
      updateChatHeader();
    });

    socket.on('disconnect', () => {
      state.isConnected = false;
      updateNavbar();
      updateChatHeader();
    });

    socket.on('userList', (onlineIds) => {
      state.onlineUsers = onlineIds || [];
      renderOnlineCounters();
      renderSidebarMembers();
    });

    socket.on('newMessage', (msg) => {
      if (state.currentRoomId === msg.roomId) {
        if (!state.messages.some(m => m._id === msg._id)) {
          state.messages.push(msg);
          playChime();
          renderMessages(true);
        }
      }
    });

    socket.on('roomCreated', () => {
      if (state.view === 'home') {
        loadRooms();
      }
    });

    socket.on('typing', ({ userId, username }) => {
      if (!state.typingUsers.some(u => u.id === userId)) {
        state.typingUsers.push({ id: userId, username });
        renderTypingIndicator();
      }
    });

    socket.on('stopTyping', ({ userId }) => {
      state.typingUsers = state.typingUsers.filter(u => u.id !== userId);
      renderTypingIndicator();
    });

    socket.on('reaction', ({ messageId, reactions }) => {
      const msg = state.messages.find(m => m._id === messageId);
      if (msg) {
        msg.reactions = reactions;
        renderReactions(messageId, reactions);
      }
    });

    socket.on('userJoined', ({ username }) => {
      showToast(`${username} joined the room`, 'info');
      refreshRoomUsers();
    });

    socket.on('userLeft', ({ username }) => {
      showToast(`${username} left the room`, 'info');
      refreshRoomUsers();
    });

    socket.on('userRemoved', ({ userId }) => {
      if (state.user && state.user.userId === userId) {
        showToast('You have been removed from this room', 'error');
        navigate('home');
      } else {
        refreshRoomUsers();
      }
    });

    socket.on('roomUpdated', (roomData) => {
      if (state.currentRoom && state.currentRoom._id === roomData._id) {
        state.currentRoom.name = roomData.name;
        updateChatHeader();
      }
    });
  }

  async function refreshRoomUsers() {
    if (!state.currentRoomId) return;
    try {
      const room = await api(`/api/rooms/${state.currentRoomId}`);
      state.currentRoom = room;
      renderSidebarMembers();
      updateChatHeader();
    } catch (e) {}
  }

  // Emoji Database
  const EMOJI_CATEGORIES = [
    { id: 'recent', name: 'Recent' },
    { id: 'smileys', name: 'Smileys' },
    { id: 'hearts', name: 'Hearts' },
    { id: 'gestures', name: 'Gestures' },
    { id: 'nature', name: 'Nature' },
    { id: 'food', name: 'Food' },
    { id: 'activities', name: 'Activities' },
    { id: 'objects', name: 'Objects' }
  ];

  const EMOJI_DATA = {
    smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😋','😛','😜','🤪','🤓','😎','🤩','🥳','😏','😒','🥺','😢','😭','😤','😠','😡','🤯','😳','🥵','🥶','😱','🤗','🤔','🤫','🤐'],
    hearts: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
    gestures: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','🖐️','✋','🖖','👏','🙌','👐','🤲','🤝','🙏'],
    nature: ['🌱','🌲','🌳','🌴','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🌺','🌸','🌼','🌻','🌞','🌝','⭐','🌟','✨','⚡','🔥','🌈','☀️','⛅','☁️','🌧️','❄️'],
    food: ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🍍','🥥','🥝','🍕','🍔','🍟','🌭','🍿','🥞','🧇','🍣','🍱','🍜','🍰','🎂','🍦','🍫','🍬','🍭','☕','🍵','🧃','🥤','🍺','🥂'],
    activities: ['⚽','🏀','🏈','⚾','🎾','🏐','🏓','🏸','🥊','🎯','🎮','🎲','🎨','🎬','🎤','🎧','🎼','🎸','🎹','🥁','🏆','🥇','🎖️'],
    objects: ['⌚','📱','💻','⌨️','🖥️','🖨️','📷','📸','📹','🔍','🔎','💡','🔦','📖','📚','💰','💵','💳','💎','🔑','🔒','🎉','🎊','🚀']
  };

  // Navigation controller
  window.navigate = async function(view, param = null) {
    if (view === 'chat' && param) {
      state.currentRoomId = param;
    }
    state.view = view;
    state.isSidebarOpen = false;
    state.isJoinModalOpen = false;
    state.activeProfileMenu = false;

    // Strict Gate: only allow 'login' and 'register' for unauthenticated users
    if (!state.token && view !== 'register') {
      state.view = 'login';
    }

    render();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  // Auth Functions
  async function checkAuth() {
    if (!state.token) return;
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      initSocket();
    } catch (err) {
      console.warn('Auth token expired or invalid:', err);
      logout();
    }
  }

  window.logout = function() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    showToast('Logged out successfully', 'info');
    navigate('login');
  };

  // UI Render Components
  function renderNavbar() {
    const isAuthed = !!state.user;
    return `
      <nav class="sticky top-0 z-40 w-full bg-[#050508]/85 backdrop-blur-2xl border-b border-white/[0.07] px-4 sm:px-6 py-3 transition-all duration-300">
        <div class="max-w-6xl mx-auto flex items-center justify-between">
          <!-- Logo & Brand -->
          <div class="flex items-center gap-3 cursor-pointer" onclick="navigate('${isAuthed ? 'home' : 'login'}')">
            <div class="relative w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 border border-white/20">
              <span class="text-base font-bold text-white tracking-wider">💬</span>
            </div>
            <span class="font-extrabold text-lg sm:text-xl tracking-wide bg-gradient-to-r from-white via-indigo-100 to-purple-200 bg-clip-text text-transparent">
              ChitChat
            </span>
          </div>

          <!-- Right Action Menu -->
          <div class="flex items-center gap-3">
            ${isAuthed ? `
              ${state.user.role === 'admin' ? `
                <button onclick="navigate('admin')" class="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg badge-cyber-red hover:bg-red-500/30 transition-all">
                  <i data-lucide="shield" class="w-3.5 h-3.5"></i>
                  <span>Admin Panel</span>
                </button>
              ` : ''}

              <!-- User Profile Menu -->
              <div class="relative">
                <button onclick="toggleProfileMenu()" class="flex items-center gap-2 p-1 rounded-full hover:bg-white/10 transition-all focus:outline-none">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-md ring-2 ring-blue-500/30">
                    ${escapeHtml(state.user.username.charAt(0).toUpperCase())}
                  </div>
                  <span class="hidden md:inline text-sm font-semibold text-gray-200">
                    ${escapeHtml(state.user.username)}
                    ${state.user.role === 'admin' ? '<span class="text-red-400 text-xs ml-1">(Admin)</span>' : ''}
                  </span>
                  <i data-lucide="chevron-down" class="w-4 h-4 text-gray-400 hidden sm:block"></i>
                </button>

                <!-- Profile Dropdown -->
                <div id="profile-dropdown" class="${state.activeProfileMenu ? 'block' : 'hidden'} absolute right-0 mt-2 w-56 glass-modal p-2 text-sm z-50 animate-slide-up">
                  <div class="px-3 py-2 border-b border-white/10 mb-1">
                    <p class="font-bold text-white truncate">${escapeHtml(state.user.username)}</p>
                    <p class="text-xs text-gray-400 truncate">${escapeHtml(state.user.email)}</p>
                    <span class="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full ${state.user.role === 'admin' ? 'badge-cyber-red' : 'badge-cyber-blue'}">
                      ${state.user.role === 'admin' ? 'Administrator' : 'Standard User'}
                    </span>
                  </div>
                  ${state.user.role === 'admin' ? `
                    <button onclick="navigate('admin')" class="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/20 text-red-300 flex items-center gap-2">
                      <i data-lucide="shield" class="w-4 h-4"></i>
                      <span>Admin Panel</span>
                    </button>
                  ` : ''}
                  <button onclick="toggleSound()" class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-gray-200 flex items-center justify-between">
                    <span class="flex items-center gap-2"><i data-lucide="${state.isSoundEnabled ? 'volume-2' : 'volume-x'}" class="w-4 h-4"></i> Sound Effects</span>
                    <span class="text-xs font-mono text-blue-400">${state.isSoundEnabled ? 'ON' : 'OFF'}</span>
                  </button>
                  <div class="h-px bg-white/10 my-1"></div>
                  <button onclick="logout()" class="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/20 text-red-400 flex items-center gap-2">
                    <i data-lucide="log-out" class="w-4 h-4"></i>
                    <span>Log Out</span>
                  </button>
                </div>
              </div>
            ` : `
              <div class="flex items-center gap-2">
                ${state.view === 'register' ? `
                  <button onclick="navigate('login')" class="text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg gradient-btn-secondary">
                    Sign In
                  </button>
                ` : `
                  <button onclick="navigate('register')" class="text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg gradient-btn-primary">
                    Create Account
                  </button>
                `}
              </div>
            `}
          </div>
        </div>
      </nav>
    `;
  }

  window.toggleProfileMenu = function() {
    state.activeProfileMenu = !state.activeProfileMenu;
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('hidden', !state.activeProfileMenu);
      dropdown.classList.toggle('block', state.activeProfileMenu);
    }
  };

  window.toggleSound = function() {
    state.isSoundEnabled = !state.isSoundEnabled;
    showToast(`Sound notifications ${state.isSoundEnabled ? 'enabled' : 'muted'}`, 'info');
    render();
  };

  document.addEventListener('click', (e) => {
    if (state.activeProfileMenu && !e.target.closest('#profile-dropdown') && !e.target.closest('button[onclick="toggleProfileMenu()"]')) {
      state.activeProfileMenu = false;
      const dropdown = document.getElementById('profile-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
    }
  });

  function updateNavbar() {
    const el = document.querySelector('nav');
    if (el) {
      el.outerHTML = renderNavbar();
      if (window.lucide) window.lucide.createIcons();
    }
  }

  // ==================== HOME VIEW ====================
  async function loadRooms() {
    if (!state.token) return;
    try {
      const rooms = await api('/api/rooms');
      state.rooms = rooms || [];
      renderRoomLists();
    } catch (err) {
      console.error('Failed to load rooms:', err);
    }
  }

  function renderHomeView() {
    return `
      ${renderNavbar()}

      <main class="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 relative z-10">
        <!-- Hero Section -->
        <section class="text-center py-6 sm:py-12">
          <h1 class="text-4xl sm:text-6xl font-extrabold text-white mb-4 tracking-tight">
            Welcome to <span class="bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">ChitChat</span>
          </h1>
          <p class="text-base sm:text-xl text-gray-300 max-w-2xl mx-auto mb-8 font-normal leading-relaxed">
            Connect with friends in real-time chat rooms. Create, join, and share conversations instantly with live reactions and typing presence.
          </p>

          ${!state.user ? `
            <div class="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto mb-8">
              <button onclick="navigate('register')" class="gradient-btn-primary px-6 py-3 rounded-xl text-base">
                Create Free Account
              </button>
              <button onclick="navigate('login')" class="gradient-btn-secondary px-6 py-3 rounded-xl text-base">
                Sign In to Existing Account
              </button>
            </div>
          ` : `
            <!-- Room Action Hub (Create or Join) -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10 text-left">
              <!-- Create Room Quick Box -->
              <div class="glass-card p-4 sm:p-5">
                <h3 class="text-sm font-bold text-gray-200 mb-2.5 flex items-center gap-2">
                  <i data-lucide="plus-circle" class="w-4 h-4 text-blue-400"></i> Create New Room
                </h3>
                <form onsubmit="handleCreateRoom(event)" class="flex gap-2">
                  <input
                    id="new-room-name"
                    type="text"
                    required
                    placeholder="Enter room name..."
                    class="flex-1 glass-input px-3.5 py-2.5 rounded-xl text-sm"
                  />
                  <button type="submit" class="gradient-btn-primary px-4 py-2.5 rounded-xl text-sm whitespace-nowrap font-semibold">
                    Create
                  </button>
                </form>
              </div>

              <!-- Join by Code Quick Box -->
              <div class="glass-card p-4 sm:p-5">
                <h3 class="text-sm font-bold text-gray-200 mb-2.5 flex items-center gap-2">
                  <i data-lucide="key-round" class="w-4 h-4 text-indigo-400"></i> Join Room by Code
                </h3>
                <form onsubmit="handleQuickCodeJoin(event)" class="flex gap-2">
                  <input
                    id="quick-join-code"
                    type="text"
                    required
                    maxlength="10"
                    placeholder="e.g. 2149C0"
                    class="flex-1 glass-input px-3.5 py-2.5 rounded-xl text-sm font-mono uppercase tracking-wider text-center"
                  />
                  <button type="submit" class="gradient-btn-secondary px-4 py-2.5 rounded-xl text-sm whitespace-nowrap font-semibold">
                    Join
                  </button>
                </form>
              </div>
            </div>
          `}
        </section>

        <!-- Feature Pillars -->
        <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <div class="glass-card p-5 hover:border-indigo-500/30 transition-all group">
            <div class="text-3xl mb-3 group-hover:scale-110 transition-transform">💬</div>
            <h4 class="font-bold text-white text-base mb-1">Real-time Messaging</h4>
            <p class="text-xs text-gray-400 leading-relaxed">Instant message delivery with live typing indicators and emoji reactions.</p>
          </div>
          <div class="glass-card p-5 hover:border-emerald-500/30 transition-all group">
            <div class="text-3xl mb-3 group-hover:scale-110 transition-transform">🏠</div>
            <h4 class="font-bold text-white text-base mb-1">Chat Rooms</h4>
            <p class="text-xs text-gray-400 leading-relaxed">Join public lounges or create private conversations with 6-character room codes.</p>
          </div>
          <div class="glass-card p-5 hover:border-purple-500/30 transition-all group">
            <div class="text-3xl mb-3 group-hover:scale-110 transition-transform">👥</div>
            <h4 class="font-bold text-white text-base mb-1">User Presence</h4>
            <p class="text-xs text-gray-400 leading-relaxed">See active participants and live online status indicators across rooms in real time.</p>
          </div>
          <div class="glass-card p-5 hover:border-amber-500/30 transition-all group">
            <div class="text-3xl mb-3 group-hover:scale-110 transition-transform">🔒</div>
            <h4 class="font-bold text-white text-base mb-1">Secure & Moderated</h4>
            <p class="text-xs text-gray-400 leading-relaxed">JWT authentication, admin dashboard, user management, and room ownership control.</p>
          </div>
        </section>

        <!-- Rooms Container -->
        ${state.user ? `
          <div id="rooms-sections-container" class="space-y-10">
            <div class="text-center py-8">
              <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p class="text-xs text-gray-400">Loading your conversations...</p>
            </div>
          </div>
        ` : ''}
      </main>

      <!-- Join Room Code Modal -->
      <div id="join-modal-backdrop" class="${state.isJoinModalOpen ? 'flex' : 'hidden'} fixed inset-0 z-50 bg-black/80 backdrop-blur-md items-center justify-center p-4">
        <div class="glass-modal w-full max-w-sm p-6 animate-slide-up">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-lg text-white">Join Room</h3>
            <button onclick="closeJoinModal()" class="text-gray-400 hover:text-white p-1">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <p class="text-xs text-gray-300 mb-4" id="join-modal-desc">
            Enter the 6-character room code to join this conversation:
          </p>
          <input
            id="join-room-code-input"
            type="text"
            maxlength="10"
            placeholder="e.g. CHIT01"
            class="w-full glass-input px-3 py-2.5 rounded-xl font-mono text-center tracking-widest text-lg font-bold uppercase mb-4"
          />
          <div class="flex gap-2">
            <button onclick="handleJoinByCode()" class="flex-1 gradient-btn-primary py-2.5 rounded-xl text-sm font-semibold">
              Join Now
            </button>
            <button onclick="closeJoinModal()" class="gradient-btn-secondary px-4 py-2.5 rounded-xl text-sm">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `;
  }

  window.handleCreateRoom = async function(e) {
    e.preventDefault();
    const input = document.getElementById('new-room-name');
    if (!input || !input.value.trim()) return;

    try {
      const newRoom = await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: input.value.trim() })
      });
      input.value = '';
      showToast(`Room "${newRoom.name}" created!`, 'success');
      await loadRooms();
      navigate('chat', newRoom._id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.openJoinModal = function(room = null) {
    state.joinModalRoom = room;
    state.isJoinModalOpen = true;
    const modal = document.getElementById('join-modal-backdrop');
    const input = document.getElementById('join-room-code-input');
    const desc = document.getElementById('join-modal-desc');

    if (room && desc) {
      desc.innerHTML = `Enter room code to join <strong class="text-white">${escapeHtml(room.name)}</strong>:`;
      if (input) input.value = '';
    } else if (desc) {
      desc.textContent = 'Enter the room code to join:';
    }

    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
    if (input) input.focus();
    if (window.lucide) window.lucide.createIcons();
  };

  window.closeJoinModal = function() {
    state.isJoinModalOpen = false;
    const modal = document.getElementById('join-modal-backdrop');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  };

  window.handleJoinByCode = async function() {
    const input = document.getElementById('join-room-code-input');
    if (!input || !input.value.trim()) {
      showToast('Please enter a room code', 'error');
      return;
    }
    try {
      const room = await api('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomCode: input.value.trim().toUpperCase() })
      });
      closeJoinModal();
      showToast(`Joined "${room.name}"!`, 'success');
      await loadRooms();
      navigate('chat', room._id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.copyRoomCode = async function(code, e) {
    if (e) e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      showToast(`Room code copied: ${code}`, 'success');
    } catch (err) {
      showToast(`Room Code: ${code}`, 'info');
    }
  };

  window.shareRoom = async function(room, e) {
    if (e) e.stopPropagation();
    const shareUrl = `${window.location.origin}/#room=${room.roomCode}`;
    const shareText = `Join me in ${room.name} on ChitChat! Use room code: ${room.roomCode}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${room.name} on ChitChat`,
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (err) {}
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      showToast('Room link and code copied to clipboard!', 'success');
    } catch (err) {
      showToast(`Room Code: ${room.roomCode}`, 'info');
    }
  };

  window.handleQuickCodeJoin = async function(e) {
    e.preventDefault();
    const input = document.getElementById('quick-join-code');
    if (!input || !input.value.trim()) return;
    try {
      const room = await api('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomCode: input.value.trim().toUpperCase() })
      });
      showToast(`Joined "${room.name}"!`, 'success');
      await loadRooms();
      navigate('chat', room._id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.handleQuickJoinRoom = async function(roomId, e) {
    if (e) e.stopPropagation();
    try {
      const room = await api(`/api/rooms/${roomId}`);
      showToast(`Joined "${room.name}"!`, 'success');
      await loadRooms();
      navigate('chat', room._id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  function renderRoomLists() {
    const container = document.getElementById('rooms-sections-container');
    if (!container || !state.user) return;

    const currentUserId = state.user.userId || state.user._id;

    function getOwnerId(room) {
      return (typeof room.createdBy === 'object' && room.createdBy) ? (room.createdBy._id || room.createdBy.userId) : room.createdBy;
    }

    function getUserIds(room) {
      return (room.users || []).map(u => (typeof u === 'object' && u ? (u._id || u.userId) : u));
    }

    const myRooms = state.rooms.filter(r => getOwnerId(r) === currentUserId);
    const joinedRooms = state.rooms.filter(r => {
      const isOwner = getOwnerId(r) === currentUserId;
      const members = getUserIds(r);
      return !isOwner && members.includes(currentUserId);
    });
    const availableRooms = state.rooms.filter(r => {
      const isOwner = getOwnerId(r) === currentUserId;
      const members = getUserIds(r);
      return !isOwner && !members.includes(currentUserId);
    });

    function makeCard(room, type) {
      const isOwner = getOwnerId(room) === currentUserId;
      const memberCount = (room.users || []).length;
      const ownerName = room.createdBy?.username || (isOwner ? state.user.username : 'User');

      return `
        <div onclick="navigate('chat', '${room._id}')" class="glass-card p-5 hover:border-indigo-500/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col justify-between group">
          <div>
            <div class="flex items-start justify-between gap-2 mb-3">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-bold flex items-center justify-center text-xs flex-shrink-0">
                  ${escapeHtml(room.name.charAt(0).toUpperCase())}
                </div>
                <div class="min-w-0">
                  <h4 class="font-bold text-white text-base truncate group-hover:text-indigo-300 transition-colors flex items-center gap-1.5">
                    ${escapeHtml(room.name)}
                    ${isOwner ? '<span title="You own this room" class="text-amber-400 text-xs">👑</span>' : ''}
                  </h4>
                  <p class="text-[11px] text-gray-400 truncate">by ${escapeHtml(ownerName)}</p>
                </div>
              </div>
              <span class="badge-cyber-blue text-xs px-2.5 py-0.5 flex items-center gap-1 flex-shrink-0">
                <i data-lucide="users" class="w-3 h-3"></i> ${memberCount}
              </span>
            </div>

            <!-- Code badge -->
            <div class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 mb-4 text-xs font-mono">
              <span class="text-gray-400">Code:</span>
              <span class="text-white font-bold tracking-wider">${escapeHtml(room.roomCode)}</span>
              <button onclick="copyRoomCode('${escapeHtml(room.roomCode)}', event)" title="Copy Code" class="ml-auto text-gray-400 hover:text-white p-1">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>

          <!-- Card Actions -->
          <div class="flex items-center gap-2 pt-3 border-t border-white/10" onclick="event.stopPropagation()">
            <button onclick="copyRoomCode('${escapeHtml(room.roomCode)}', event)" class="flex-1 gradient-btn-secondary py-1.5 text-xs rounded-lg flex items-center justify-center gap-1.5">
              <i data-lucide="copy" class="w-3 h-3"></i> Copy
            </button>
            <button onclick="shareRoom(${JSON.stringify(room).replace(/"/g, '&quot;')}, event)" class="gradient-btn-secondary px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-center">
              <i data-lucide="share-2" class="w-3 h-3"></i>
            </button>
            ${type === 'available' ? `
              <button onclick="handleQuickJoinRoom('${room._id}', event)" class="flex-1 gradient-btn-primary py-1.5 text-xs rounded-lg flex items-center justify-center gap-1.5 font-semibold">
                Join Room
              </button>
            ` : `
              <button onclick="navigate('chat', '${room._id}')" class="flex-1 gradient-btn-primary py-1.5 text-xs rounded-lg flex items-center justify-center gap-1.5 font-semibold">
                Open
              </button>
            `}
          </div>
        </div>
      `;
    }

    let html = '';

    if (myRooms.length > 0) {
      html += `
        <div>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-white flex items-center gap-2">
              <span>My Rooms</span>
              <span class="badge-cyber text-xs px-2 py-0.5">${myRooms.length}</span>
            </h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${myRooms.map(r => makeCard(r, 'my')).join('')}
          </div>
        </div>
      `;
    }

    if (joinedRooms.length > 0) {
      html += `
        <div>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-white flex items-center gap-2">
              <span>Joined Rooms</span>
              <span class="badge-cyber text-xs px-2 py-0.5">${joinedRooms.length}</span>
            </h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${joinedRooms.map(r => makeCard(r, 'joined')).join('')}
          </div>
        </div>
      `;
    }

    if (availableRooms.length > 0) {
      html += `
        <div>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-white flex items-center gap-2">
              <span>Available Lounges</span>
              <span class="badge-cyber text-xs px-2 py-0.5">${availableRooms.length}</span>
            </h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${availableRooms.map(r => makeCard(r, 'available')).join('')}
          </div>
        </div>
      `;
    }

    if (state.rooms.length === 0) {
      html = `
        <div class="text-center py-16 glass-card p-8">
          <div class="text-5xl mb-4">🚀</div>
          <h3 class="text-xl font-bold text-white mb-2">No Chat Rooms Yet</h3>
          <p class="text-sm text-gray-400 mb-6 max-w-sm mx-auto">Create your first room above to start chatting with teammates and friends!</p>
        </div>
      `;
    }

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  }

  // ==================== CHAT ROOM VIEW ====================
  let chatPollTimer = null;

  async function loadChatRoom(roomId) {
    state.messages = [];
    state.typingUsers = [];
    try {
      const room = await api(`/api/rooms/${roomId}`);
      state.currentRoom = room;

      const msgData = await api(`/api/messages/${roomId}?limit=50&skip=0`);
      state.messages = msgData.messages || [];
      state.totalMessages = msgData.total || 0;

      if (socket && state.isConnected && state.user) {
        socket.emit('joinRoom', { roomId, userId: state.user.userId });
      }

      // Start fallback polling (ensures real-time messages even on serverless/Vercel)
      if (chatPollTimer) clearInterval(chatPollTimer);
      chatPollTimer = setInterval(async () => {
        if (state.view !== 'chat' || state.currentRoomId !== roomId || !state.token) {
          clearInterval(chatPollTimer);
          return;
        }
        if (socket && state.isConnected) return; // Socket handles incoming messages
        try {
          const fresh = await api(`/api/messages/${roomId}?limit=50&skip=0`);
          const freshList = fresh.messages || [];
          if (freshList.length !== state.messages.length) {
            state.messages = freshList;
            renderMessages(true);
          }
        } catch (e) {}
      }, 2500);

      render();
      scrollMessagesToBottom(false);
    } catch (err) {
      showToast(err.message, 'error');
      navigate('home');
    }
  }

  function renderChatView() {
    const room = state.currentRoom || { name: 'Loading room...', roomCode: '...' };
    const isOwner = state.user && room.createdBy && (room.createdBy._id === state.user.userId || room.createdBy === state.user.userId);
    const isAdmin = state.user && state.user.role === 'admin';
    const canManageRoom = isOwner || isAdmin;
    const memberCount = (room.users || []).length;

    return `
      <!-- Fixed Cyber Chat Header -->
      <header class="fixed top-0 left-0 right-0 z-30 bg-[#050508]/90 backdrop-blur-2xl border-b border-white/[0.07] px-3 sm:px-6 py-2.5 shadow-2xl">
        <div class="max-w-5xl mx-auto flex items-center justify-between">
          <!-- Back & Room details -->
          <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button onclick="leaveCurrentRoom()" class="p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 transition-all flex-shrink-0">
              <i data-lucide="arrow-left" class="w-5 h-5"></i>
            </button>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="font-bold text-white text-base sm:text-lg truncate">${escapeHtml(room.name)}</h2>
                ${isOwner ? '<span title="You own this room" class="text-amber-400 text-xs flex-shrink-0">👑</span>' : ''}
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-400">
                <span class="flex items-center gap-1 font-mono cursor-pointer hover:text-blue-300 transition-colors" onclick="copyRoomCode('${escapeHtml(room.roomCode)}')">
                  <span class="text-gray-500">#</span>${escapeHtml(room.roomCode)}
                  <i data-lucide="copy" class="w-3 h-3 text-gray-400"></i>
                </span>
                <span>•</span>
                <span>${memberCount} members</span>
                <span>•</span>
                <span id="chat-header-status" class="flex items-center gap-1 ${state.isConnected ? 'text-emerald-400' : 'text-amber-400'}">
                  <span class="w-2 h-2 rounded-full ${state.isConnected ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse"></span>
                  <span class="hidden sm:inline">${state.isConnected ? 'Connected' : 'Connecting...'}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Header Tools -->
          <div class="flex items-center gap-1.5 sm:gap-2">
            <button onclick="shareRoom(${JSON.stringify(room).replace(/"/g, '&quot;')})" title="Share Room" class="p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 transition-all">
              <i data-lucide="share-2" class="w-4 h-4 sm:w-5 sm:h-5"></i>
            </button>
            <button onclick="toggleSidebar()" title="Room Info & Members" class="p-2 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 transition-all relative">
              <i data-lucide="users" class="w-4 h-4 sm:w-5 sm:h-5"></i>
            </button>
            ${canManageRoom ? `
              <button onclick="handleDeleteCurrentRoom()" title="Delete Room" class="p-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-all">
                <i data-lucide="trash-2" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </header>

      <!-- Message History Container -->
      <main class="flex-1 max-w-4xl mx-auto w-full pt-20 pb-28 px-3 sm:px-6 flex flex-col justify-end">
        <!-- Messages Stream -->
        <div id="messages-container" class="space-y-4">
          ${renderMessagesHtml()}
        </div>

        <!-- Live Typing Indicator -->
        <div id="typing-indicator-container" class="pt-2"></div>
      </main>

      <!-- Sticky Cyber Message Input Bar -->
      <footer class="fixed bottom-0 left-0 right-0 z-30 bg-[#050508]/90 backdrop-blur-2xl border-t border-white/[0.07] p-2.5 sm:p-4 shadow-2xl">
        <div class="max-w-4xl mx-auto relative">
          <!-- Emoji Picker Popover -->
          <div id="emoji-picker" class="${state.isEmojiPickerOpen ? 'block' : 'hidden'} absolute bottom-full mb-3 left-0 sm:left-4 z-50 glass-modal w-[94vw] sm:w-80 max-w-sm p-3 animate-slide-up shadow-2xl">
            <!-- Emoji Search -->
            <div class="mb-2">
              <input
                id="emoji-search-input"
                type="text"
                placeholder="Search emojis..."
                value="${escapeHtml(state.emojiSearch)}"
                oninput="handleEmojiSearch(this.value)"
                class="w-full glass-input px-3 py-1.5 rounded-lg text-xs"
              />
            </div>
            <!-- Category Tabs -->
            <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-2 mb-2 border-b border-white/10">
              ${EMOJI_CATEGORIES.map(cat => `
                <button onclick="selectEmojiCategory('${cat.id}')" class="px-2 py-1 rounded-md text-xs whitespace-nowrap transition-all ${state.selectedEmojiCategory === cat.id ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white'}">
                  ${cat.name}
                </button>
              `).join('')}
            </div>
            <!-- Emoji Grid -->
            <div class="grid grid-cols-7 sm:grid-cols-8 gap-1.5 max-h-48 overflow-y-auto scrollbar-cyber p-1" id="emoji-grid-content">
              ${renderEmojiGrid()}
            </div>
          </div>

          <!-- Message Form -->
          <form onsubmit="handleSendMessage(event)" class="flex items-center gap-2">
            <!-- Emoji Button -->
            <button type="button" onclick="toggleEmojiPicker()" class="p-2.5 sm:p-3 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 transition-all flex-shrink-0 text-lg">
              😊
            </button>

            <!-- Text Input -->
            <input
              id="chat-message-input"
              type="text"
              autocomplete="off"
              placeholder="Type your message... (Press Enter to send)"
              oninput="handleTypingInput()"
              class="flex-1 glass-input px-4 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base"
            />

            <!-- Send Button -->
            <button type="submit" class="gradient-btn-primary px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-sm font-semibold flex items-center gap-1.5 flex-shrink-0">
              <i data-lucide="send" class="w-4 h-4"></i>
              <span class="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>
      </footer>

      <!-- Room Info Sidebar Drawer (Radix-style Sheet) -->
      <div id="room-sidebar-backdrop" class="${state.isSidebarOpen ? 'block' : 'hidden'} fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onclick="toggleSidebar()">
        <div class="fixed top-0 bottom-0 right-0 w-full sm:w-96 glass-modal rounded-none border-l border-blue-900/50 p-5 overflow-y-auto scrollbar-cyber flex flex-col justify-between animate-slide-right" onclick="event.stopPropagation()">
          <div>
            <div class="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
              <h3 class="font-extrabold text-lg text-white">Room Details</h3>
              <button onclick="toggleSidebar()" class="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                <i data-lucide="x" class="w-5 h-5"></i>
              </button>
            </div>

            <!-- Editable Room Name -->
            <div class="mb-5">
              <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Room Name</label>
              ${canManageRoom ? `
                <div class="flex gap-2">
                  <input id="edit-room-name-input" type="text" value="${escapeHtml(room.name)}" class="flex-1 glass-input px-3 py-2 rounded-xl text-sm" />
                  <button onclick="handleUpdateRoomName()" class="gradient-btn-primary px-3 py-2 rounded-xl text-xs font-semibold">Save</button>
                </div>
              ` : `
                <p class="text-sm font-bold text-white bg-white/5 border border-white/10 p-2.5 rounded-xl">${escapeHtml(room.name)}</p>
              `}
            </div>

            <!-- Room Code -->
            <div class="mb-6">
              <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Room Code</label>
              <div class="flex items-center justify-between bg-black/40 border border-white/15 px-3.5 py-2.5 rounded-xl font-mono text-sm">
                <span class="font-bold text-blue-300 tracking-wider">${escapeHtml(room.roomCode)}</span>
                <button onclick="copyRoomCode('${escapeHtml(room.roomCode)}')" class="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                  <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy
                </button>
              </div>
            </div>

            <!-- Members List -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Members (${memberCount})</label>
              </div>
              <div id="sidebar-members-list" class="space-y-2">
                ${renderSidebarMembersHtml()}
              </div>
            </div>
          </div>

          <!-- Leave Button -->
          <div class="pt-6 border-t border-white/10 mt-6">
            <button onclick="leaveCurrentRoom()" class="w-full gradient-btn-danger py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
              <i data-lucide="log-out" class="w-4 h-4"></i> Leave Room
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function updateChatHeader() {
    const el = document.getElementById('chat-header-status');
    if (!el) return;
    el.className = `flex items-center gap-1 ${state.isConnected ? 'text-emerald-400' : 'text-amber-400'}`;
    el.innerHTML = `
      <span class="w-2 h-2 rounded-full ${state.isConnected ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse"></span>
      <span class="hidden sm:inline">${state.isConnected ? 'Connected' : 'Connecting...'}</span>
    `;
  }

  window.toggleSidebar = function() {
    state.isSidebarOpen = !state.isSidebarOpen;
    const backdrop = document.getElementById('room-sidebar-backdrop');
    if (backdrop) {
      backdrop.classList.toggle('hidden', !state.isSidebarOpen);
      backdrop.classList.toggle('block', state.isSidebarOpen);
    }
    if (window.lucide) window.lucide.createIcons();
  };

  window.toggleEmojiPicker = function() {
    state.isEmojiPickerOpen = !state.isEmojiPickerOpen;
    const picker = document.getElementById('emoji-picker');
    if (picker) {
      picker.classList.toggle('hidden', !state.isEmojiPickerOpen);
      picker.classList.toggle('block', state.isEmojiPickerOpen);
    }
  };

  window.selectEmojiCategory = function(catId) {
    state.selectedEmojiCategory = catId;
    state.emojiSearch = '';
    const grid = document.getElementById('emoji-grid-content');
    if (grid) grid.innerHTML = renderEmojiGrid();
  };

  window.handleEmojiSearch = function(query) {
    state.emojiSearch = query.trim().toLowerCase();
    const grid = document.getElementById('emoji-grid-content');
    if (grid) grid.innerHTML = renderEmojiGrid();
  };

  function renderEmojiGrid() {
    let list = [];
    if (state.emojiSearch) {
      list = Object.values(EMOJI_DATA).flat().filter(e => e.includes(state.emojiSearch));
    } else if (state.selectedEmojiCategory === 'recent') {
      list = state.recentEmojis;
    } else {
      list = EMOJI_DATA[state.selectedEmojiCategory] || [];
    }

    if (list.length === 0) {
      return '<div class="col-span-8 text-center text-xs text-gray-500 py-4">No emojis found</div>';
    }

    return list.map(emoji => `
      <button type="button" onclick="insertEmoji('${emoji}')" class="text-xl p-1.5 rounded-lg hover:bg-white/15 hover:scale-125 transition-transform flex items-center justify-center">
        ${emoji}
      </button>
    `).join('');
  }

  window.insertEmoji = function(emoji) {
    const input = document.getElementById('chat-message-input');
    if (input) {
      input.value += emoji;
      input.focus();
    }
    state.recentEmojis = [emoji, ...state.recentEmojis.filter(e => e !== emoji)].slice(0, 16);
    localStorage.setItem('recentEmojis', JSON.stringify(state.recentEmojis));
    toggleEmojiPicker();
  };

  window.handleTypingInput = function() {
    if (!socket || !state.isConnected || !state.currentRoomId || !state.user) return;
    socket.emit('typing', { roomId: state.currentRoomId, userId: state.user.userId });
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('stopTyping', { roomId: state.currentRoomId, userId: state.user.userId });
    }, 1800);
  };

  window.handleSendMessage = async function(e) {
    e.preventDefault();
    const input = document.getElementById('chat-message-input');
    if (!input || !input.value.trim() || !state.currentRoomId) return;

    const content = input.value.trim();
    input.value = '';
    input.focus();

    if (socket && state.isConnected && state.user) {
      socket.emit('stopTyping', { roomId: state.currentRoomId, userId: state.user.userId });
    }

    try {
      const msg = await api(`/api/messages/${state.currentRoomId}`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });

      if (!state.messages.some(m => m._id === msg._id)) {
        state.messages.push(msg);
        renderMessages(true);
      }

      if (socket && state.isConnected) {
        socket.emit('broadcastMessage', { roomId: state.currentRoomId, message: msg });
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.handleReaction = async function(messageId, reaction) {
    if (!state.user || !state.currentRoomId) return;

    // Instant local reaction toggle for instant responsive feel
    const msg = state.messages.find(m => m._id === messageId);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (msg.reactions[state.user.userId] === reaction) {
        delete msg.reactions[state.user.userId];
      } else {
        msg.reactions[state.user.userId] = reaction;
      }
      renderMessages(false);
    }

    if (socket && state.isConnected) {
      socket.emit('reaction', {
        messageId,
        userId: state.user.userId,
        reaction
      });
    }

    try {
      await api(`/api/messages/${state.currentRoomId}/${messageId}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ reaction })
      });
    } catch (e) {}
  };

  window.copyMessageText = async function(content) {
    try {
      await navigator.clipboard.writeText(content);
      showToast('Message copied to clipboard', 'success');
    } catch (e) {
      showToast('Failed to copy', 'error');
    }
  };

  window.deleteMessage = async function(messageId) {
    if (!confirm('Are you sure you want to delete this message?')) return;
    try {
      await api(`/api/messages/${state.currentRoomId}/${messageId}`, { method: 'DELETE' });
      const msg = state.messages.find(m => m._id === messageId);
      if (msg) msg.deleted = true;
      renderMessages(false);
      showToast('Message deleted', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.handleUpdateRoomName = async function() {
    const input = document.getElementById('edit-room-name-input');
    if (!input || !input.value.trim()) return;
    try {
      const updated = await api(`/api/rooms/${state.currentRoomId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: input.value.trim() })
      });
      state.currentRoom = updated;
      if (socket && state.isConnected) {
        socket.emit('roomUpdated', { roomId: state.currentRoomId, roomData: updated });
      }
      showToast('Room name updated!', 'success');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.handleDeleteCurrentRoom = async function() {
    if (!confirm('Are you sure you want to delete this chat room? All messages will be permanently removed.')) return;
    try {
      await api(`/api/rooms/${state.currentRoomId}`, { method: 'DELETE' });
      showToast('Room deleted', 'info');
      navigate('home');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.leaveCurrentRoom = function() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    if (socket && state.isConnected && state.currentRoomId && state.user) {
      socket.emit('leaveRoom', { roomId: state.currentRoomId, userId: state.user.userId });
    }
    state.currentRoomId = null;
    state.currentRoom = null;
    state.messages = [];
    navigate('home');
  };

  window.removeUserFromRoom = async function(userId) {
    if (!confirm('Remove this user from the room?')) return;
    try {
      await api(`/api/rooms/${state.currentRoomId}/users/${userId}`, { method: 'DELETE' });
      if (socket && state.isConnected) {
        socket.emit('removeUser', { roomId: state.currentRoomId, userId });
      }
      showToast('User removed from room', 'success');
      refreshRoomUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  function renderMessagesHtml() {
    if (!state.messages || state.messages.length === 0) {
      return `
        <div class="text-center py-16 text-gray-400">
          <div class="text-4xl mb-3">💬</div>
          <p class="font-semibold text-white">No messages yet</p>
          <p class="text-xs text-gray-500 mt-1">Be the first to say hello in this room!</p>
        </div>
      `;
    }

    const currentUserId = state.user?.userId;
    const roomOwnerId = state.currentRoom?.createdBy?._id || state.currentRoom?.createdBy;
    const isAdmin = state.user?.role === 'admin';

    return state.messages.map(msg => {
      const isOwn = msg.sender && msg.sender._id === currentUserId;
      const isMsgOwner = msg.sender && (msg.sender._id === roomOwnerId);
      const canDelete = isOwn || isAdmin || (currentUserId === roomOwnerId);
      const reactions = msg.reactions || {};

      let heartCount = 0;
      let thumbsCount = 0;
      let smileCount = 0;
      for (const [uId, rVal] of Object.entries(reactions)) {
        if (rVal === 'heart') heartCount++;
        if (rVal === 'thumbsup') thumbsCount++;
        if (rVal === 'smile') smileCount++;
      }

      const myReaction = reactions[currentUserId];

      return `
        <div class="flex ${isOwn ? 'justify-end' : 'justify-start'} group items-end gap-2 animate-slide-up" id="msg-row-${msg._id}">
          ${!isOwn ? `
            <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-700 to-gray-800 text-gray-200 text-xs font-bold flex items-center justify-center ring-2 ring-white/10 flex-shrink-0">
              ${escapeHtml((msg.sender?.username || 'U').charAt(0).toUpperCase())}
            </div>
          ` : ''}

          <div class="max-w-[85%] sm:max-w-[70%]">
            <div class="${isOwn ? 'message-bubble-own' : 'message-bubble-other'} p-3 sm:p-4 relative">
              <div class="flex items-center justify-between gap-3 text-xs mb-1.5 opacity-90">
                <span class="font-bold flex items-center gap-1">
                  ${escapeHtml(msg.sender?.username || 'Unknown')}
                  ${isMsgOwner ? '<span title="Room Owner" class="text-amber-300 text-[10px]">👑</span>' : ''}
                  ${isOwn ? '<span class="text-[10px] opacity-75 font-normal">(You)</span>' : ''}
                </span>
                <span class="text-[10px] opacity-75 font-mono">${timeAgo(msg.createdAt)}</span>
              </div>

              ${msg.deleted ? `
                <p class="text-xs sm:text-sm italic text-gray-400">This message was deleted.</p>
              ` : `
                <p class="text-sm sm:text-base leading-relaxed break-words whitespace-pre-wrap">${escapeHtml(msg.content)}</p>
              `}

              ${!msg.deleted ? `
                <div class="flex items-center justify-between gap-3 mt-2.5 pt-2 border-t border-white/10 text-xs">
                  <div class="flex items-center gap-1">
                    <button onclick="handleReaction('${msg._id}', 'heart')" class="px-2 py-0.5 rounded-full text-xs transition-all ${myReaction === 'heart' ? 'bg-red-500/30 text-red-200 border border-red-500/40' : 'hover:bg-white/10 opacity-70 hover:opacity-100'}">
                      ❤️ ${heartCount > 0 ? heartCount : ''}
                    </button>
                    <button onclick="handleReaction('${msg._id}', 'thumbsup')" class="px-2 py-0.5 rounded-full text-xs transition-all ${myReaction === 'thumbsup' ? 'bg-blue-500/30 text-blue-200 border border-blue-500/40' : 'hover:bg-white/10 opacity-70 hover:opacity-100'}">
                      👍 ${thumbsCount > 0 ? thumbsCount : ''}
                    </button>
                    <button onclick="handleReaction('${msg._id}', 'smile')" class="px-2 py-0.5 rounded-full text-xs transition-all ${myReaction === 'smile' ? 'bg-amber-500/30 text-amber-200 border border-amber-500/40' : 'hover:bg-white/10 opacity-70 hover:opacity-100'}">
                      😊 ${smileCount > 0 ? smileCount : ''}
                    </button>
                  </div>

                  <div class="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button onclick="copyMessageText('${escapeHtml(msg.content)}')" title="Copy Text" class="p-1 hover:text-white transition-colors">
                      <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                    </button>
                    ${canDelete ? `
                      <button onclick="deleteMessage('${msg._id}')" title="Delete Message" class="p-1 text-red-400 hover:text-red-300 transition-colors">
                        <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMessages(autoScroll = false) {
    const container = document.getElementById('messages-container');
    if (container) {
      container.innerHTML = renderMessagesHtml();
      if (window.lucide) window.lucide.createIcons();
      if (autoScroll) {
        scrollMessagesToBottom(true);
      }
    }
  }

  function scrollMessagesToBottom(smooth = true) {
    setTimeout(() => {
      const container = document.getElementById('messages-container');
      if (container && container.lastElementChild) {
        container.lastElementChild.scrollIntoView({
          behavior: smooth ? 'smooth' : 'auto',
          block: 'end'
        });
      } else {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto'
        });
      }
    }, 60);
  }

  function renderTypingIndicator() {
    const container = document.getElementById('typing-indicator-container');
    if (!container) return;

    if (state.typingUsers.length === 0) {
      container.innerHTML = '';
      return;
    }

    const names = state.typingUsers.map(u => u.username).join(', ');
    const verb = state.typingUsers.length === 1 ? 'is' : 'are';

    container.innerHTML = `
      <div class="inline-flex items-center gap-2 glass-card px-3.5 py-1.5 text-xs text-blue-300 animate-slide-up">
        <div class="flex gap-1 items-center">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400 typing-dot-1"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400 typing-dot-2"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400 typing-dot-3"></span>
        </div>
        <span><strong>${escapeHtml(names)}</strong> ${verb} typing...</span>
      </div>
    `;
  }

  function renderReactions(messageId, reactions) {
    renderMessages(false);
  }

  function renderSidebarMembersHtml() {
    if (!state.currentRoom || !state.currentRoom.users) return '';
    const roomOwnerId = (typeof state.currentRoom.createdBy === 'object' && state.currentRoom.createdBy) 
      ? (state.currentRoom.createdBy._id || state.currentRoom.createdBy.userId)
      : state.currentRoom.createdBy;
    const canManage = (state.user && state.user.userId === roomOwnerId) || (state.user && state.user.role === 'admin');

    return state.currentRoom.users.map(u => {
      const uId = typeof u === 'object' ? (u._id || u.userId) : u;
      const uName = typeof u === 'object' ? (u.username || 'User') : 'User';
      const isOnline = state.onlineUsers.includes(uId);
      const isUserOwner = uId === roomOwnerId;
      const isMe = state.user && state.user.userId === uId;

      return `
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="relative flex-shrink-0">
              <div class="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-xs flex items-center justify-center">
                ${escapeHtml((uName).charAt(0).toUpperCase())}
              </div>
              <span class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-black ${isOnline ? 'bg-emerald-400' : 'bg-gray-500'}"></span>
            </div>
            <div class="min-w-0">
              <p class="text-xs font-semibold text-white truncate flex items-center gap-1">
                ${escapeHtml(uName)}
                ${isMe ? '<span class="text-[10px] text-gray-400 font-normal">(You)</span>' : ''}
                ${isUserOwner ? '<span title="Room Owner" class="text-amber-400 text-xs">👑</span>' : ''}
              </p>
              <p class="text-[10px] ${isOnline ? 'text-emerald-400' : 'text-gray-500'} font-medium">
                ${isOnline ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>

          ${canManage && !isMe ? `
            <button onclick="removeUserFromRoom('${uId}')" title="Remove User" class="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
              <i data-lucide="user-minus" class="w-4 h-4"></i>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function renderSidebarMembers() {
    const list = document.getElementById('sidebar-members-list');
    if (list) {
      list.innerHTML = renderSidebarMembersHtml();
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function renderOnlineCounters() {}

  // ==================== ADMIN PANEL VIEW ====================
  async function loadAdminData() {
    if (!state.token || !state.user || state.user.role !== 'admin') return;
    try {
      const [rooms, users] = await Promise.all([
        api('/api/rooms'),
        api('/api/users')
      ]);
      state.rooms = rooms || [];
      state.usersList = users || [];
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderAdminView() {
    const totalRooms = state.rooms.length;
    const totalUsers = state.usersList.length;
    const adminCount = state.usersList.filter(u => u.role === 'admin').length;
    const regularCount = totalUsers - adminCount;

    return `
      ${renderNavbar()}

      <main class="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 relative z-10">
        <div class="text-center mb-8">
          <h1 class="text-3xl sm:text-4xl font-extrabold text-white mb-2">Admin Dashboard</h1>
          <p class="text-sm text-gray-400">Manage rooms, user permissions, and platform activities</p>
        </div>

        <!-- Metric Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div class="glass-card p-4 text-center">
            <p class="text-2xl sm:text-3xl font-extrabold text-blue-400 mb-1">${totalRooms}</p>
            <p class="text-xs text-gray-400 font-medium">Total Rooms</p>
          </div>
          <div class="glass-card p-4 text-center">
            <p class="text-2xl sm:text-3xl font-extrabold text-purple-400 mb-1">${totalUsers}</p>
            <p class="text-xs text-gray-400 font-medium">Total Users</p>
          </div>
          <div class="glass-card p-4 text-center">
            <p class="text-2xl sm:text-3xl font-extrabold text-red-400 mb-1">${adminCount}</p>
            <p class="text-xs text-gray-400 font-medium">Admins</p>
          </div>
          <div class="glass-card p-4 text-center">
            <p class="text-2xl sm:text-3xl font-extrabold text-emerald-400 mb-1">${regularCount}</p>
            <p class="text-xs text-gray-400 font-medium">Regular Users</p>
          </div>
        </div>

        <!-- Tab Bar -->
        <div class="flex gap-2 justify-center mb-6">
          <button onclick="setAdminTab('rooms')" class="px-5 py-2 rounded-xl text-sm font-semibold transition-all ${state.adminTab === 'rooms' ? 'gradient-btn-primary' : 'gradient-btn-secondary'}">
            Room Management (${totalRooms})
          </button>
          <button onclick="setAdminTab('users')" class="px-5 py-2 rounded-xl text-sm font-semibold transition-all ${state.adminTab === 'users' ? 'gradient-btn-primary' : 'gradient-btn-secondary'}">
            User Management (${totalUsers})
          </button>
        </div>

        ${state.adminTab === 'rooms' ? `
          <div class="glass-card p-5">
            <h3 class="font-bold text-white text-base mb-4">All Active Rooms</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              ${state.rooms.map(room => `
                <div class="p-4 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between">
                  <div>
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <h4 class="font-bold text-white text-base truncate">${escapeHtml(room.name)}</h4>
                      <span class="badge-cyber-blue text-xs px-2 py-0.5">${(room.users || []).length} users</span>
                    </div>
                    <p class="text-xs text-gray-400 mb-1">Code: <span class="font-mono text-white font-bold">${escapeHtml(room.roomCode)}</span></p>
                    <p class="text-xs text-gray-400 mb-4">Owner: <span class="text-gray-200">${escapeHtml(room.createdBy?.username || 'Unknown')}</span></p>
                  </div>
                  <div class="flex gap-2">
                    <button onclick="navigate('chat', '${room._id}')" class="flex-1 gradient-btn-primary py-1.5 text-xs rounded-lg font-semibold">Join Room</button>
                    <button onclick="adminDeleteRoom('${room._id}')" class="gradient-btn-danger px-3 py-1.5 text-xs rounded-lg">Delete</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="glass-card p-5">
            <h3 class="font-bold text-white text-base mb-4">Registered Platform Users</h3>
            <div class="space-y-3">
              ${state.usersList.map(u => `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-black/40 border border-white/10 gap-3">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold flex items-center justify-center">
                      ${escapeHtml(u.username.charAt(0).toUpperCase())}
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-white text-sm">${escapeHtml(u.username)}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'badge-cyber-red' : 'badge-cyber-blue'}">
                          ${u.role}
                        </span>
                      </div>
                      <p class="text-xs text-gray-400">${escapeHtml(u.email)}</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    ${u._id !== state.user.userId ? `
                      <button onclick="adminToggleRole('${u._id}', '${u.role === 'admin' ? 'user' : 'admin'}')" class="gradient-btn-secondary px-3 py-1.5 rounded-lg text-xs font-semibold">
                        ${u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                      </button>
                      <button onclick="adminDeleteUser('${u._id}')" class="gradient-btn-danger px-3 py-1.5 rounded-lg text-xs font-semibold">
                        Delete
                      </button>
                    ` : '<span class="text-xs text-gray-500 italic pr-2">Current account</span>'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `}
      </main>
    `;
  }

  window.setAdminTab = function(tab) {
    state.adminTab = tab;
    render();
  };

  window.adminDeleteRoom = async function(roomId) {
    if (!confirm('Are you sure you want to permanently delete this room?')) return;
    try {
      await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
      showToast('Room deleted', 'success');
      loadAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.adminDeleteUser = async function(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await api(`/api/users/${userId}`, { method: 'DELETE' });
      showToast('User deleted', 'success');
      loadAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.adminToggleRole = async function(userId, newRole) {
    try {
      await api(`/api/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole })
      });
      showToast(`User role updated to ${newRole}`, 'success');
      loadAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ==================== AUTH VIEWS (LOGIN & REGISTER) ====================
  function renderLoginView() {
    return `
      ${renderNavbar()}

      <main class="flex-1 flex items-center justify-center p-4 relative z-10">
        <div class="glass-card w-full max-w-md p-6 sm:p-8 animate-slide-up">
          <div class="text-center mb-6">
            <div class="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg shadow-indigo-500/25 border border-white/20">
              💬
            </div>
            <h2 class="text-2xl font-extrabold text-white tracking-tight">Welcome Back</h2>
            <p class="text-xs text-gray-400 mt-1">Sign in to your ChitChat account to continue</p>
          </div>

          <form onsubmit="handleLoginSubmit(event)" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-gray-300 mb-1.5">Email Address</label>
              <input
                id="login-email"
                type="email"
                required
                placeholder="name@example.com"
                class="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-300 mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                required
                placeholder="••••••••"
                class="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm"
              />
            </div>

            <button type="submit" class="w-full gradient-btn-primary py-3 rounded-xl text-sm font-semibold mt-2">
              Sign In
            </button>
          </form>

          <p class="text-center text-xs text-gray-400 mt-6">
            Don't have an account?
            <button onclick="navigate('register')" class="text-blue-400 hover:underline font-semibold ml-1">
              Sign Up
            </button>
          </p>
        </div>
      </main>
    `;
  }

  function renderRegisterView() {
    return `
      ${renderNavbar()}

      <main class="flex-1 flex items-center justify-center p-4 relative z-10">
        <div class="glass-card w-full max-w-md p-6 sm:p-8 animate-slide-up">
          <div class="text-center mb-6">
            <div class="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg shadow-indigo-500/25 border border-white/20">
              🚀
            </div>
            <h2 class="text-2xl font-extrabold text-white tracking-tight">Create Account</h2>
            <p class="text-xs text-gray-400 mt-1">Join ChitChat and connect with people instantly</p>
          </div>

          <form onsubmit="handleRegisterSubmit(event)" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-gray-300 mb-1.5">Username</label>
              <input
                id="register-username"
                type="text"
                required
                placeholder="Choose a username"
                class="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-300 mb-1.5">Email Address</label>
              <input
                id="register-email"
                type="email"
                required
                placeholder="name@example.com"
                class="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-300 mb-1.5">Password</label>
              <input
                id="register-password"
                type="password"
                required
                placeholder="At least 6 characters"
                class="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm"
              />
            </div>

            <button type="submit" class="w-full gradient-btn-primary py-3 rounded-xl text-sm font-semibold mt-2">
              Create Account
            </button>
          </form>

          <p class="text-center text-xs text-gray-400 mt-6">
            Already have an account?
            <button onclick="navigate('login')" class="text-blue-400 hover:underline font-semibold ml-1">
              Sign In
            </button>
          </p>
        </div>
      </main>
    `;
  }

  window.handleLoginSubmit = async function(e) {
    e.preventDefault();
    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    if (!email || !password) return;

    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('token', res.token);
      showToast(`Welcome back, ${res.user.username}!`, 'success');
      initSocket();
      navigate('home');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.handleRegisterSubmit = async function(e) {
    e.preventDefault();
    const username = document.getElementById('register-username')?.value.trim();
    const email = document.getElementById('register-email')?.value.trim();
    const password = document.getElementById('register-password')?.value;
    if (!username || !email || !password) return;

    try {
      const res = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password })
      });
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('token', res.token);
      showToast(`Welcome to ChitChat, ${res.user.username}!`, 'success');
      initSocket();
      navigate('home');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Main Render Switcher
  function render() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    // Strict Login Protection: unauthenticated users may only see 'login' or 'register'
    if (!state.token && state.view !== 'register') {
      state.view = 'login';
    }

    switch (state.view) {
      case 'home':
        appEl.innerHTML = renderHomeView();
        loadRooms();
        break;
      case 'login':
        appEl.innerHTML = renderLoginView();
        break;
      case 'register':
        appEl.innerHTML = renderRegisterView();
        break;
      case 'chat':
        if (state.currentRoomId && (!state.currentRoom || state.currentRoom._id !== state.currentRoomId)) {
          loadChatRoom(state.currentRoomId);
        } else {
          appEl.innerHTML = renderChatView();
        }
        break;
      case 'admin':
        appEl.innerHTML = renderAdminView();
        loadAdminData();
        break;
      default:
        appEl.innerHTML = state.token ? renderHomeView() : renderLoginView();
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // App Initialization
  async function init() {
    await checkAuth();

    if (!state.token || !state.user) {
      if (state.view !== 'register') {
        state.view = 'login';
      }
    } else {
      if (state.view === 'login' || state.view === 'register') {
        state.view = 'home';
      }
    }

    const hash = window.location.hash;
    if (hash && hash.startsWith('#room=')) {
      const code = hash.replace('#room=', '');
      if (state.token) {
        try {
          const room = await api('/api/rooms/join', {
            method: 'POST',
            body: JSON.stringify({ roomCode: code.toUpperCase() })
          });
          showToast(`Joined ${room.name}!`, 'success');
          state.view = 'chat';
          state.currentRoomId = room._id;
          state.currentRoom = room;
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
    }

    render();
  }

  window.onload = init;
})();
