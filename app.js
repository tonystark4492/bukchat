import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, EmailAuthProvider, linkWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  reauthenticateWithCredential, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, onChildAdded, remove,
  onDisconnect, serverTimestamp, query, limitToLast, orderByChild, startAt, update
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig } from "./config.js";

const MAX_MEMBERS = 50;
// Rooms. The first one keeps the old database key "chatroom1" so all its
// existing messages stay exactly where they are; only the display name changed.
const ROOMS = [
  { id: "chatroom1",     emoji: "🌐", name: "Global",            desc: "Everyone, everywhere" },
  { id: "room_desi",     emoji: "🇮🇳", name: "Desi Zone",         desc: "South Asia" },
  { id: "room_afroarab", emoji: "🌍", name: "Afro-Arab Zone",    desc: "Africa and the Middle East" },
  { id: "room_americas", emoji: "🌎", name: "Americas Zone",     desc: "North and South America" },
  { id: "room_asiapacific", emoji: "🌏", name: "Asia-Pacific Zone", desc: "East Asia, Southeast Asia and Oceania" }
];
let currentRoom = ROOMS[0];
let ROOM = currentRoom.id; // database key of the room the user is in
const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll(".screen").forEach((s) =>
    s.classList.toggle("active", s.id === id));
}
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}
const withTimeout = (p, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const validName = (n) => /^[A-Za-z0-9_]{3,15}$/.test(n);
const usernameEmail = (name) => name.trim().toLowerCase() + "@bukchat.invalid";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

let auth, db, uid = null, myName = null, mySlot = null;
let inRoom = false, unsubs = [], lobbyUnsub = null;
const nameCache = {};
const splashDone = new Promise((r) => setTimeout(r, 2000));

async function boot() {
  $("retryBtn").style.display = "none";
  $("splashMsg").textContent = "";

  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
    await splashDone;
    $("splashMsg").textContent = "Setup needed: check config.js.";
    return;
  }

  let route;
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);

    const user = await withTimeout(new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (u) => {
        unsubscribe();
        resolve(u);
      });
    }), 12000);

    if (user) {
      uid = user.uid;
      const snap = await withTimeout(get(ref(db, "users/" + uid)), 12000);
      if (snap.exists()) {
        myName = snap.val().name;
        route = "lobby";
      } else {
        route = "register";
      }
    } else {
      route = "login";
    }
  } catch (e) {
    await splashDone;
    $("splashMsg").textContent = "Can't connect. Check your internet and try again.";
    $("retryBtn").style.display = "inline-block";
    return;
  }

  await splashDone;
  if (route === "lobby") enterLobby();
  else if (route === "register") enterRegister();
  else enterLogin();
}
$("retryBtn").onclick = () => location.reload();

let checkTimer, nameOk = false, registerMode = "new";

function enterLogin() {
  show("login");
  $("loginName").focus();
}
function enterRegister(upgrade = false) {
  registerMode = upgrade ? "upgrade" : "new";
  show("register");
  $("nameInput").value = upgrade ? (myName || "") : "";
  $("passwordInput").value = "";
  $("nameHint").className = "";
  $("nameHint").textContent = upgrade
    ? "Choose a password for your existing account."
    : "3–15 letters, numbers or _";
  nameOk = false;
  $("regBtn").disabled = true;
  if (upgrade && myName) checkName(myName);
  else $("nameInput").focus();
}

async function checkName(v) {
  const hint = $("nameHint");
  nameOk = false;
  $("regBtn").disabled = true;
  if (!v) {
    hint.className = "";
    hint.textContent = "3–15 letters, numbers or _";
    return;
  }
  if (!validName(v)) {
    hint.className = "bad";
    hint.textContent = "Use 3–15 letters, numbers or _ only";
    return;
  }
  hint.className = "";
  hint.textContent = "Checking…";
  try {
    const snap = await get(ref(db, "names/" + v.toLowerCase()));
    if ($("nameInput").value.trim() !== v) return;
    if (snap.exists() && snap.val() !== uid) {
      hint.className = "bad";
      hint.textContent = "“" + v + "” is already taken";
    } else {
      hint.className = "ok";
      hint.textContent = "“" + v + "” is available ✓";
      nameOk = true;
      $("regBtn").disabled = false;
    }
  } catch (e) {
    hint.className = "bad";
    hint.textContent = "Couldn't check. Check your connection.";
  }
}

$("nameInput").addEventListener("input", () => {
  const v = $("nameInput").value.trim();
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => checkName(v), 350);
});
$("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && nameOk) $("regBtn").click();
});

$("regBtn").onclick = async () => {
  const v = $("nameInput").value.trim();
  const password = $("passwordInput").value;
  if (!nameOk || !validName(v)) return;
  if (password.length < 6) {
    toast("Password must be at least 6 characters.");
    return;
  }
  $("regBtn").disabled = true;

  try {
    const current = auth.currentUser;

    if (registerMode === "upgrade" && current && current.isAnonymous) {
      const credential = EmailAuthProvider.credential(usernameEmail(v), password);
      await linkWithCredential(current, credential);
      uid = auth.currentUser.uid;
      myName = v;
      toast("Password added. Your existing account is preserved.");
      enterLobby();
      return;
    }

    if (current && current.isAnonymous) {
      const credential = EmailAuthProvider.credential(usernameEmail(v), password);
      await linkWithCredential(current, credential);
      uid = auth.currentUser.uid;
    } else {
      await setPersistence(auth, $("regRemember").checked
        ? browserLocalPersistence : browserSessionPersistence);
      const result = await createUserWithEmailAndPassword(
        auth, usernameEmail(v), password);
      uid = result.user.uid;
    }

    const key = v.toLowerCase();
    try {
      await set(ref(db, "names/" + key), uid);
    } catch (e) {
      const cur = await get(ref(db, "names/" + key));
      if (cur.val() !== uid) {
        $("nameHint").className = "bad";
        $("nameHint").textContent = "Sorry, “" + v + "” was just taken. Try another.";
        nameOk = false;
        return;
      }
    }

    await set(ref(db, "users/" + uid), {
      name: v, joined: serverTimestamp()
    });
    myName = v;
    // Remember this new member's joining point (used to hide older chat history).
    try {
      await set(ref(db, ROOMS[0].id + "/members/" + uid + "/since"), serverTimestamp());
    } catch (e) { /* not fatal: it is created again when the room is first opened */ }
    enterLobby();
  } catch (e) {
    const code = String(e?.code || "");
    toast(code.includes("email-already-in-use") ||
      code.includes("credential-already-in-use")
      ? "That username already has an account. Please log in."
      : code.includes("weak-password")
      ? "Use a password with at least 6 characters."
      : "Registration failed. Check your connection and try again.");
    $("regBtn").disabled = false;
  }
};

$("showLoginBtn").onclick = enterLogin;
$("showRegisterBtn").onclick = () => enterRegister(false);

$("loginBtn").onclick = async () => {
  const name = $("loginName").value.trim();
  const password = $("loginPassword").value;
  if (!validName(name) || !password) {
    toast("Enter your username and password.");
    return;
  }
  $("loginBtn").disabled = true;
  try {
    await setPersistence(auth, $("rememberMe").checked
      ? browserLocalPersistence : browserSessionPersistence);
    const result = await signInWithEmailAndPassword(
      auth, usernameEmail(name), password);
    uid = result.user.uid;
    const snap = await get(ref(db, "users/" + uid));
    if (!snap.exists()) {
      toast("Account profile not found.");
      await signOut(auth);
      return;
    }
    myName = snap.val().name;
    enterLobby();
  } catch (e) {
    toast("Login failed. Check your username and password.");
  } finally {
    $("loginBtn").disabled = false;
  }
};
$("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("loginBtn").click();
});

async function doLogout() {
  if (inRoom) await leaveChat(false);
  if (lobbyUnsub) {
    lobbyUnsub();
    lobbyUnsub = null;
  }
  stopPrivateListeners();
  try {
    await signOut(auth);
    uid = null;
    myName = null;
    mySlot = null;
    enterLogin();
  } catch (e) {
    toast("Couldn't log out. Try again.");
  }
}
function doAddPassword() { enterRegister(true); }

function renderRooms() {
  const list = $("roomList");
  list.innerHTML = "";
  ROOMS.forEach((room) => {
    const b = document.createElement("button");
    b.className = "roomBtn";
    b.dataset.room = room.id;
    b.innerHTML =
      '<div class="ic"></div><div class="rt"><div class="nm"></div>' +
      '<div class="desc"></div>' +
      '<div class="sub"><span class="dot"></span><span class="cnt">0 / ' + MAX_MEMBERS + ' online</span></div>' +
      '</div><div class="go">›</div>';
    b.querySelector(".ic").textContent = room.emoji;
    b.querySelector(".nm").textContent = room.name;
    b.querySelector(".desc").textContent = room.desc;
    b.onclick = () => joinRoom(room, b);
    list.append(b);
  });
}

function enterLobby() {
  show("lobby");
  setTab("rooms"); // the app always opens on Chat Rooms
  startPrivateListeners();
  $("meName").textContent = myName;
  if (lobbyUnsub) lobbyUnsub();
  renderRooms();
  const offs = ROOMS.map((room) =>
    onValue(ref(db, room.id + "/slots"), (snap) => {
      const n = snap.exists() ? Object.keys(snap.val()).length : 0;
      const el = document.querySelector('[data-room="' + room.id + '"]');
      if (!el) return;
      el.querySelector(".cnt").textContent = n + " / " + MAX_MEMBERS + " online";
      el.querySelector(".dot").classList.toggle("full", n >= MAX_MEMBERS);
    }));
  lobbyUnsub = () => offs.forEach((off) => off());
}

// Each member has a private record in every room, at <room>/members/<uid>:
//   since   = the moment their chat history starts (0 = everything)
//   greeted = true once the welcome message has been shown
async function loadMembership(room) {
  const base = room.id + "/members/" + uid;
  let snap = await get(ref(db, base));
  let since = snap.child("since").val();
  let greeted = snap.child("greeted").val() === true;
  const clearedAt = Number(snap.child("clearedAt").val()) || 0;

  if (since === null) {
    // No record yet. Accounts made before this update are "existing" users and
    // keep their whole history. The database rules only allow since = 0 for them.
    try {
      await set(ref(db, base + "/since"), 0);
      since = 0;
      // Only the original room counts as already greeted. Existing users have
      // never seen the welcome of the new zones, so they get it once there.
      if (room.id === ROOMS[0].id) {
        try { await set(ref(db, base + "/greeted"), true); greeted = true; } catch (e) {}
      }
    } catch (e) {
      if (String(e?.code || e).toUpperCase().includes("PERMISSION")) {
        // Newer account: its history starts when the account was created.
        const sinceRef = ref(db, base + "/since");
        const j = (await get(ref(db, "users/" + uid + "/joined"))).val();
        if (typeof j === "number") {
          await set(sinceRef, j);
          since = j;
        } else {
          await set(sinceRef, serverTimestamp());
          since = (await get(sinceRef)).val();
        }
      } else {
        throw e; // network problem: do not guess, let the caller retry
      }
    }
  }
  since = Number(since) || 0;
  // start = where this member's visible history begins (join point or last "delete history")
  return { since, greeted, clearedAt, start: Math.max(since, clearedAt) };
}

async function joinRoom(room, btn) {
  btn.disabled = true;
  currentRoom = room;
  ROOM = room.id;
  let membership;
  try {
    membership = await withTimeout(loadMembership(room), 12000);
  } catch (e) {
    btn.disabled = false;
    toast("Couldn't open the chat. Check your connection and try again.");
    return;
  }
  const ok = await claimSlot();
  btn.disabled = false;
  if (!ok) {
    toast(room.name + " is full (" + MAX_MEMBERS + "/" + MAX_MEMBERS + "). Try again later.");
    return;
  }
  openChat(membership);
}

async function claimSlot() {
  const order = [...Array(MAX_MEMBERS).keys()];
  if (mySlot !== null) order.unshift(mySlot);
  for (const i of order) {
    const r = ref(db, ROOM + "/slots/" + i);
    try {
      await withTimeout(set(r, uid), 8000);
      await onDisconnect(r).remove();
      mySlot = i;
      return true;
    } catch (e) {}
  }
  mySlot = null;
  return false;
}

let currentMembership = null, msgOff = null;
const pendingKeys = new Set();

// Only messages from this member's visible start onward, newest 100 of those.
function startMessageListener() {
  if (msgOff) { msgOff(); msgOff = null; }
  const q = query(
    ref(db, ROOM + "/messages"),
    orderByChild("ts"),
    startAt(currentMembership.start),
    limitToLast(100)
  );
  msgOff = onChildAdded(q, (snap) => addMessage(snap.val(), snap.key));
}

function openChat(membership) {
  inRoom = true;
  if (lobbyUnsub) {
    lobbyUnsub();
    lobbyUnsub = null;
  }
  show("chat");
  $("chatTitle").textContent = currentRoom.emoji + " " + currentRoom.name;
  $("msgs").innerHTML = "";
  if (!membership.greeted) {
    const greetings = [
      "👋 Hey there! Glad you're here. 😊",
      "🌟 Welcome! Hope you're having a great day!",
      "😎 Hey! Make yourself comfortable.",
      "😂 New face detected. Vibe check pending!",
      "⚡ Fresh energy just arrived. What's the vibe?",
      "🌑 Relax, take a breath, and enjoy the conversation.",
      "🔥 Welcome in! Good conversations start with one message.",
      "🌈 Sending good vibes your way. Glad you're here!"
    ];
    addSystem(greetings[Math.floor(Math.random() * greetings.length)]);
    membership.greeted = true;
    // Shown only once per account (not saved as a chat message).
    set(ref(db, ROOM + "/members/" + uid + "/greeted"), true).catch(() => {});
  }
  history.pushState({ chat: true }, "");

  unsubs.push(onValue(ref(db, ROOM + "/slots"), async (snap) => {
    const uids = snap.exists() ? Object.values(snap.val()) : [];
    $("memCount").textContent = uids.length + "/" + MAX_MEMBERS;
    $("chatSub").textContent = uids.length + " online";
    const names = await Promise.all(uids.map(getName));
    const ul = $("memList");
    ul.innerHTML = "";
    names.forEach((n, i) => {
      const li = document.createElement("li");
      const av = document.createElement("div");
      av.className = "av";
      av.textContent = (n || "?")[0].toUpperCase();
      const nm = document.createElement("span");
      nm.textContent = n || "…";
      li.append(av, nm);
      if (uids[i] === uid) {
        const y = document.createElement("span");
        y.className = "you";
        y.textContent = "you";
        li.append(y);
        li.className = "me";
      } else {
        li.onclick = () => openUserSheet(uids[i], n);
      }
      ul.append(li);
    });
  }));

  currentMembership = membership;
  unsubs.push(() => { if (msgOff) { msgOff(); msgOff = null; } });
  startMessageListener();

  unsubs.push(onValue(ref(db, ".info/connected"), async (s) => {
    if (s.val() === true && inRoom) {
      const ok = await claimSlot();
      if (!ok) {
        toast(currentRoom.name + " became full. You were moved out.");
        leaveChat(true);
      }
    }
  }));

  setTimeout(() => $("msgInput").focus(), 200);
}

async function getName(u) {
  if (nameCache[u]) return nameCache[u];
  try {
    const s = await get(ref(db, "users/" + u + "/name"));
    nameCache[u] = s.val();
  } catch (e) {}
  return nameCache[u];
}

function addSystem(text) {
  const d = document.createElement("div");
  d.className = "sys";
  d.textContent = text;
  $("msgs").append(d);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + time;
}

function addMessage(m, key) {
  if (!m || typeof m.text !== "string") return;
  const box = $("msgs");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const mine = m.uid === uid;
  const d = document.createElement("div");
  d.className = "msg " + (mine ? "mine" : "other");
  if (key) d.dataset.key = key;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = m.name || "?";
  if (!mine && m.uid) {
    who.classList.add("tap");
    who.onclick = () => openUserSheet(m.uid, m.name);
  }
  const body = document.createElement("div");
  body.textContent = m.text;
  const tm = document.createElement("div");
  tm.className = "tm";
  tm.textContent = m.ts ? fmtTime(m.ts) : "";
  if (mine) {
    // 🕓 = still sending, ✓ = the server has it
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = pendingKeys.has(key) ? " 🕓" : " ✓";
    tm.append(tick);
  }
  d.append(who, body, tm);
  box.append(d);
  while (box.childElementCount > 300) box.firstElementChild.remove(); // keep the page light
  if (nearBottom || mine) box.scrollTop = box.scrollHeight;
}

// ---------- Send sound (made in code, no sound file needed) ----------
let soundEnabled = true;
try { soundEnabled = localStorage.getItem("bukchat-sound") !== "off"; } catch (e) {}
let audioCtx = null;
function playSendSound() {
  if (!soundEnabled) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const tone = (type, f1, f2, start, dur, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t + start);
      o.frequency.exponentialRampToValueAtTime(f2, t + start + dur * 0.6);
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(vol, t + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + start); o.stop(t + start + dur + 0.02);
    };
    tone("sine", 420, 900, 0, 0.17, 0.28);      // soft rising "bloop"
    tone("triangle", 1350, 1700, 0.06, 0.12, 0.07); // tiny sparkle on top
  } catch (e) {}
}
function renderSoundBtn() { $("soundToggle").textContent = soundEnabled ? "On" : "Off"; }
$("soundToggle").onclick = () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem("bukchat-sound", soundEnabled ? "on" : "off"); } catch (e) {}
  renderSoundBtn();
  playSendSound();
};
renderSoundBtn();

$("sendForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msgInput").value.trim();
  if (!text) return;
  playSendSound();
  $("msgInput").value = "";
  const msgRef = push(ref(db, ROOM + "/messages"));
  const key = msgRef.key;
  pendingKeys.add(key);
  try {
    await set(msgRef, { uid, name: myName, text, ts: serverTimestamp() });
    pendingKeys.delete(key);
    const t = document.querySelector('.msg[data-key="' + key + '"] .tick');
    if (t) t.textContent = " ✓";
  } catch (err) {
    pendingKeys.delete(key);
    const el = document.querySelector('.msg[data-key="' + key + '"]');
    if (el) el.remove();
    toast("Message not sent. Check your connection.");
    $("msgInput").value = text;
  }
  $("msgInput").focus();
});

async function leaveChat(fromPop) {
  if (!inRoom) return;
  inRoom = false;
  unsubs.forEach((u) => {
    try { u(); } catch (e) {}
  });
  unsubs = [];
  if (mySlot !== null) {
    const r = ref(db, ROOM + "/slots/" + mySlot);
    try {
      await onDisconnect(r).cancel();
      await remove(r);
    } catch (e) {}
    mySlot = null;
  }
  $("sheet").classList.remove("open");
  enterLobby();
}

// Back button. In the installed Android app we handle it ourselves (so it never
// drops to the phone's home screen from a chat); in a browser we use history.
const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
function goBack() {
  if ($("menuShade").classList.contains("open")) { closeMenu(); return; }
  for (const id of ["confirmSheet", "clearSheet", "userSheet", "sheet"]) {
    if ($(id).classList.contains("open")) { $(id).classList.remove("open"); return; }
  }
  if (blockedOpen) { closeBlocked(); return; }
  if (settingsOpen) { closeSettings(); return; }
  if (dmOpen) { leaveDm(); return; }
  if (inRoom) { leaveChat(); return; }
  // On the lobby / login screens: send the app to the background like other apps.
  if (CapApp) { if (CapApp.minimizeApp) CapApp.minimizeApp(); else if (CapApp.exitApp) CapApp.exitApp(); }
}
if (CapApp && CapApp.addListener) CapApp.addListener("backButton", goBack);
$("backBtn").onclick = () => {
  if (!inRoom) return;
  if (CapApp) leaveChat(); else history.back();
};
window.addEventListener("popstate", () => {
  if (blockedOpen) { closeBlocked(); return; }
  if (settingsOpen) { closeSettings(); return; }
  if (dmOpen) { leaveDm(); return; }
  if (inRoom) leaveChat(true);
});
$("membersBtn").onclick = () => $("sheet").classList.add("open");
$("sheet").onclick = (e) => {
  if (e.target.id === "sheet") $("sheet").classList.remove("open");
};

// ---------- Colour themes ----------
const THEMES = ["orange", "red", "pink", "blue", "green", "purple"];
function applyTheme(t) {
  if (!THEMES.includes(t)) t = "orange";
  document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll(".sw").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
}
document.querySelectorAll(".sw").forEach((b) => {
  b.onclick = () => {
    applyTheme(b.dataset.t);
    try { localStorage.setItem("bukchat-theme", b.dataset.t); } catch (e) {}
  };
});
let savedTheme = null;
try { savedTheme = localStorage.getItem("bukchat-theme"); } catch (e) {}
applyTheme(savedTheme);

// ---------- 3-dot menu ----------
function openMenu(btn, items) {
  const menu = $("menu");
  menu.innerHTML = "";
  items.forEach((it) => {
    const b = document.createElement("button");
    b.textContent = it.label;
    if (it.danger) b.className = "danger";
    b.onclick = () => { closeMenu(); it.fn(); };
    menu.append(b);
  });
  const r = btn.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + "px";
  menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  $("menuShade").classList.add("open");
}
function closeMenu() { $("menuShade").classList.remove("open"); }
$("menuShade").onclick = (e) => { if (e.target.id === "menuShade") closeMenu(); };

$("lobbyMenuBtn").onclick = () => {
  const items = [{ label: "⚙️  Settings", fn: openSettings }];
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    items.push({ label: "🔑  Add password", fn: doAddPassword });
  }
  items.push({ label: "Log out", fn: doLogout });
  openMenu($("lobbyMenuBtn"), items);
};
$("chatMenuBtn").onclick = () =>
  openMenu($("chatMenuBtn"), [
    { label: "⚙️  Settings", fn: openSettings },
    { label: "🗑  Delete chat history", danger: true, fn: askClearThisRoom }
  ]);

// ---------- Settings screen ----------
let settingsOpen = false, settingsReturn = "lobby";
function openSettings() {
  const active = document.querySelector(".screen.active");
  settingsReturn = active && active.id !== "settings" ? active.id : "lobby";
  $("setName").textContent = myName || "";
  settingsOpen = true;
  history.pushState({ settings: true }, "");
  show("settings");
}
function closeSettings() {
  settingsOpen = false;
  show(settingsReturn);
}
$("settingsBack").onclick = () => { if (CapApp) closeSettings(); else history.back(); };


// ---------- Delete chat history (clear for me only) ----------
// Nothing is removed from the database and other members are not affected.
// We just remember "I cleared at this moment" and show messages newer than that.
function askConfirm(title, text, okLabel, onOk) {
  $("clearTitle").textContent = title;
  $("clearText").textContent = text;
  $("clearOk").textContent = okLabel;
  $("clearOk").disabled = false;
  $("clearSheet").classList.add("open");
  $("clearOk").onclick = async () => {
    $("clearOk").disabled = true;
    try { await onOk(); } finally { $("clearSheet").classList.remove("open"); }
  };
}
$("clearCancel").onclick = () => $("clearSheet").classList.remove("open");

async function markCleared(room) {
  const cRef = ref(db, room.id + "/members/" + uid + "/clearedAt");
  await set(cRef, serverTimestamp());
  return Number((await get(cRef)).val()) || Date.now();
}
function resetChatView(start) {
  if (!inRoom || !currentMembership) return;
  currentMembership.start = Math.max(currentMembership.start, start);
  $("msgs").innerHTML = "";
  startMessageListener();
}

function askClearThisRoom() {
  const room = currentRoom;
  askConfirm(
    "Delete " + room.name + " history?",
    "This clears the " + room.name + " chat history for you only. Other members keep their messages. You will only see new messages from now on.",
    "Delete history",
    async () => {
      try {
        const start = await markCleared(room);
        resetChatView(start);
        toast(room.name + " history deleted.");
      } catch (e) {
        toast("Couldn't delete history. Check your connection.");
      }
    });
}

$("clearAllBtn").onclick = () => {
  askConfirm(
    "Delete all chat history?",
    "This clears the history of all " + ROOMS.length + " rooms for you only. Other members keep their messages. You will only see new messages from now on.",
    "Delete all",
    async () => {
      try {
        for (const room of ROOMS) {
          const start = await markCleared(room);
          if (inRoom && room.id === currentRoom.id) resetChatView(start);
        }
        toast("All chat history deleted.");
      } catch (e) {
        toast("Couldn't finish. Check your connection and try again.");
      }
    });
};

// ---------- Private chats (DMs) ----------
// Database layout (see database.rules.json):
//   dms/<convId>/meta            who the two people are (written once)
//   dms/<convId>/messages/<id>   {from, text, ts}
//   inbox/<uid>/<convId>         my chat-list entry: with, last, from, ts, n (their sent count),
//                                sent (my sent count), seen (their count I have read), clearedAt
//   blocks/<uid>/<otherUid>      true = I blocked them
// convId = the two user ids, sorted, joined with "_".
const dmConv = (a, b) => (a < b ? a + "_" + b : b + "_" + a);
let lobbyTab = "rooms";
let inboxCache = {}, blocksCache = {}, inboxOff = null, blocksOff = null, inboxReady = false;
let dmOpen = false, dmReturn = "lobby", dmOther = null, dmConvId = null, dmOff = null, dmName = "";
let blockedOpen = false;
const sentLocal = {};

function setTab(t) {
  lobbyTab = t;
  $("tabRooms").classList.toggle("on", t === "rooms");
  $("tabChats").classList.toggle("on", t === "chats");
  $("roomsPane").hidden = t !== "rooms";
  $("chatsPane").hidden = t !== "chats";
}
$("tabRooms").onclick = () => setTab("rooms");
$("tabChats").onclick = () => setTab("chats");

const unreadOf = (e) => Math.max(0, (Number(e.n) || 0) - (Number(e.seen) || 0));
const dmVisible = (e) => e && e.with && e.ts && e.ts > (Number(e.clearedAt) || 0) && !blocksCache[e.with];

function startPrivateListeners() {
  if (inboxOff || !uid) return;
  inboxReady = false;
  inboxOff = onValue(ref(db, "inbox/" + uid), (snap) => {
    const next = snap.val() || {};
    if (inboxReady) {
      for (const c of Object.keys(next)) {
        const e = next[c], was = inboxCache[c];
        if ((Number(e.n) || 0) > ((was && Number(was.n)) || 0) && e.with &&
            !blocksCache[e.with] && !(dmOpen && dmConvId === c)) {
          getName(e.with).then((nm) => toast("💬 New message from " + (nm || "someone")));
        }
      }
    }
    inboxCache = next;
    inboxReady = true;
    renderChats(); updateBadge(); markDmSeen();
  }, () => {});
  blocksOff = onValue(ref(db, "blocks/" + uid), (snap) => {
    blocksCache = snap.val() || {};
    renderChats(); renderBlocked(); updateBadge(); updateDmComposer();
  }, () => {});
}
function stopPrivateListeners() {
  if (inboxOff) { inboxOff(); inboxOff = null; }
  if (blocksOff) { blocksOff(); blocksOff = null; }
  if (dmOff) { dmOff(); dmOff = null; }
  inboxCache = {}; blocksCache = {}; inboxReady = false;
  dmOpen = false; blockedOpen = false; dmOther = null; dmConvId = null;
  $("dmBadge").hidden = true;
  $("dmList").innerHTML = "";
}

function updateBadge() {
  let total = 0;
  Object.values(inboxCache).forEach((e) => { if (dmVisible(e)) total += unreadOf(e); });
  const b = $("dmBadge");
  b.hidden = total === 0;
  b.textContent = total > 99 ? "99+" : String(total);
}

function fmtListTime(ts) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function renderChats() {
  const list = $("dmList");
  const items = Object.entries(inboxCache)
    .filter(([, e]) => dmVisible(e))
    .sort((a, b) => b[1].ts - a[1].ts);
  list.innerHTML = "";
  $("dmEmpty").style.display = items.length ? "none" : "";
  items.forEach(([, e]) => {
    const b = document.createElement("button");
    const un = unreadOf(e);
    b.className = "dmItem" + (un ? " unread" : "");
    const av = document.createElement("div"); av.className = "av"; av.textContent = "?";
    const mid = document.createElement("div"); mid.className = "mid";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = "…";
    const pv = document.createElement("div"); pv.className = "pv";
    pv.textContent = (e.from === uid ? "You: " : "") + (e.last || "");
    mid.append(nm, pv);
    const rt = document.createElement("div"); rt.className = "rt2";
    const tm = document.createElement("div"); tm.className = "tmx"; tm.textContent = fmtListTime(e.ts);
    rt.append(tm);
    if (un) {
      const bd = document.createElement("span"); bd.className = "badge";
      bd.textContent = un > 99 ? "99+" : String(un);
      rt.append(bd);
    }
    b.append(av, mid, rt);
    b.onclick = () => openDm(e.with, "lobby");
    list.append(b);
    getName(e.with).then((n) => {
      nm.textContent = n || "Unknown user";
      av.textContent = (n || "?")[0].toUpperCase();
    });
  });
}

// Search: exact username -> open a private chat with that person.
$("dmSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("dmSearchInput").value.trim();
  if (!v) return;
  if (!validName(v)) { toast("Usernames are 3–15 letters, numbers or _"); return; }
  $("dmSearchBtn").disabled = true;
  try {
    const snap = await withTimeout(get(ref(db, "names/" + v.toLowerCase())), 10000);
    const other = snap.val();
    if (!other) toast("No user named “" + v + "”.");
    else if (other === uid) toast("That's you 🙂");
    else { $("dmSearchInput").value = ""; openDm(other, "lobby"); }
  } catch (err) {
    toast("Couldn't search. Check your connection.");
  }
  $("dmSearchBtn").disabled = false;
});

async function openDm(other, from) {
  if (!other || other === uid) return;
  dmReturn = from === "chat" ? "chat" : "lobby";
  dmOther = other;
  dmConvId = dmConv(uid, other);
  dmName = nameCache[other] || "";
  dmOpen = true;
  history.pushState({ dm: true }, "");
  $("dmMsgs").innerHTML = "";
  $("dmTitle").textContent = dmName || "…";
  $("dmAv").textContent = (dmName || "?")[0].toUpperCase();
  show("dm");
  updateDmComposer();
  const conv = dmConvId;
  getName(other).then((n) => {
    if (dmOther !== other) return;
    dmName = n || "Unknown user";
    $("dmTitle").textContent = dmName;
    $("dmAv").textContent = dmName[0].toUpperCase();
    updateDmComposer();
  });
  // First time with this person: create the conversation record (the rules allow
  // this once, only for the two people in it). If it already exists this just fails quietly.
  if (!inboxCache[conv]) {
    const a = uid < other ? uid : other, b = uid < other ? other : uid;
    try { await set(ref(db, "dms/" + conv + "/meta"), { a, b }); } catch (e) {}
    if (dmConvId !== conv) return;
  }
  if (dmOff) { dmOff(); dmOff = null; }
  const start = Number(inboxCache[conv] && inboxCache[conv].clearedAt) || 0;
  const q = query(ref(db, "dms/" + conv + "/messages"), orderByChild("ts"), startAt(start), limitToLast(100));
  dmOff = onChildAdded(q, (snap) => addDmMessage(snap.val(), snap.key),
    () => { if (dmConvId === conv) toast("Can't open this chat right now."); });
  markDmSeen();
  if (!blocksCache[other]) setTimeout(() => { if (dmOpen) $("dmInput").focus(); }, 250);
}

function leaveDm() {
  if (!dmOpen) return;
  dmOpen = false;
  if (dmOff) { dmOff(); dmOff = null; }
  dmOther = null; dmConvId = null;
  closeMenu();
  if (dmReturn === "chat" && inRoom) show("chat");
  else { show("lobby"); setTab("chats"); }
}
$("dmBack").onclick = () => { if (CapApp) leaveDm(); else history.back(); };

function addDmMessage(m, key) {
  if (!m || typeof m.text !== "string") return;
  const box = $("dmMsgs");
  if (key && box.querySelector('[data-key="' + key + '"]')) return; // already shown
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const mine = m.from === uid;
  const d = document.createElement("div");
  d.className = "msg " + (mine ? "mine" : "other");
  if (key) d.dataset.key = key;
  const body = document.createElement("div");
  body.textContent = m.text;
  const tm = document.createElement("div");
  tm.className = "tm";
  tm.textContent = m.ts ? fmtTime(m.ts) : "";
  if (mine) {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = pendingKeys.has(key) ? " 🕓" : " ✓";
    tm.append(tick);
  }
  d.append(body, tm);
  box.append(d);
  while (box.childElementCount > 300) box.firstElementChild.remove();
  if (nearBottom || mine) box.scrollTop = box.scrollHeight;
}

// Tell the other side's list that I have read everything so far.
function markDmSeen() {
  if (!dmOpen || !dmConvId) return;
  const e = inboxCache[dmConvId];
  if (e && (Number(e.n) || 0) > (Number(e.seen) || 0)) {
    set(ref(db, "inbox/" + uid + "/" + dmConvId + "/seen"), Number(e.n)).catch(() => {});
  }
}

function updateDmComposer() {
  const blocked = !!(dmOther && blocksCache[dmOther]);
  $("dmForm").style.display = blocked ? "none" : "";
  $("dmBlockedBar").classList.toggle("show", blocked);
  $("dmBlockedText").textContent = "You blocked " + (dmName || "this user") + ". Unblock to send messages.";
}

$("dmForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("dmInput").value.trim();
  if (!text || !dmOther) return;
  if (blocksCache[dmOther]) { toast("Unblock this user to send messages."); return; }
  $("dmInput").value = "";
  playSendSound();
  const conv = dmConvId, other = dmOther;
  const key = push(ref(db, "dms/" + conv + "/messages")).key;
  pendingKeys.add(key);
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    try {
      // My own sent-counter lives in my chat-list entry; the rules require it to go up by exactly 1.
      let base;
      if (attempt === 0) base = Math.max(Number(inboxCache[conv] && inboxCache[conv].sent) || 0, sentLocal[conv] || 0);
      else base = Number((await get(ref(db, "inbox/" + uid + "/" + conv + "/sent"))).val()) || 0;
      const n = base + 1;
      sentLocal[conv] = n;
      const ts = serverTimestamp(), preview = text.slice(0, 80);
      const mine = "inbox/" + uid + "/" + conv + "/", theirs = "inbox/" + other + "/" + conv + "/";
      const u = {};
      u["dms/" + conv + "/messages/" + key] = { from: uid, text, ts };
      u[mine + "with"] = other; u[mine + "last"] = preview; u[mine + "from"] = uid; u[mine + "ts"] = ts; u[mine + "sent"] = n;
      u[theirs + "with"] = uid; u[theirs + "last"] = preview; u[theirs + "from"] = uid; u[theirs + "ts"] = ts; u[theirs + "n"] = n;
      await update(ref(db), u);
      ok = true;
    } catch (err) {}
  }
  pendingKeys.delete(key);
  if (ok) {
    const t = document.querySelector('#dmMsgs .msg[data-key="' + key + '"] .tick');
    if (t) t.textContent = " ✓";
  } else {
    delete sentLocal[conv];
    const el = document.querySelector('#dmMsgs .msg[data-key="' + key + '"]');
    if (el) el.remove();
    toast("Message not sent. Check your connection, or you may not be able to message this user.");
    if (dmConvId === conv) $("dmInput").value = text;
  }
});

// ---- Block / unblock ----
function askBlock(otherUid, name) {
  askConfirm(
    "Block " + name + "?",
    "They won't be able to message you, and you won't be able to message them. You can unblock them any time in Settings → Blocked accounts. They won't be told.",
    "Block",
    async () => {
      try {
        await set(ref(db, "blocks/" + uid + "/" + otherUid), true);
        toast(name + " blocked.");
      } catch (e) { toast("Couldn't block. Check your connection."); }
    });
}
async function unblockUser(otherUid, name) {
  try {
    await remove(ref(db, "blocks/" + uid + "/" + otherUid));
    toast(name + " unblocked.");
  } catch (e) { toast("Couldn't unblock. Check your connection."); }
}
$("dmUnblockBtn").onclick = () => { if (dmOther) unblockUser(dmOther, dmName || "User"); };
$("dmMenuBtn").onclick = () => {
  if (!dmOther) return;
  const other = dmOther, name = dmName || "this user", blocked = !!blocksCache[other];
  openMenu($("dmMenuBtn"), [
    blocked
      ? { label: "✅  Unblock " + name, fn: () => unblockUser(other, name) }
      : { label: "🚫  Block " + name, danger: true, fn: () => askBlock(other, name) },
    { label: "🗑  Delete chat", danger: true, fn: askDeleteDm }
  ]);
};

// Delete chat = remove it from MY list and hide its history for me. The other person keeps everything.
function askDeleteDm() {
  const conv = dmConvId, name = dmName || "this user";
  const e = inboxCache[conv];
  if (!e) { toast("Nothing to delete yet."); return; }
  askConfirm(
    "Delete chat with " + name + "?",
    "This removes the chat from your list and clears it for you only. " + name +
      " keeps their messages. If they message you again, the chat comes back with only the new messages.",
    "Delete chat",
    async () => {
      try {
        await update(ref(db), {
          ["inbox/" + uid + "/" + conv + "/clearedAt"]: serverTimestamp(),
          ["inbox/" + uid + "/" + conv + "/seen"]: Number(e.n) || 0
        });
        toast("Chat deleted.");
        leaveDm();
      } catch (err) { toast("Couldn't delete. Check your connection."); }
    });
}

// ---- Tap a name in a chat room -> Message / Block ----
let usTarget = null;
function openUserSheet(otherUid, name) {
  if (!otherUid || otherUid === uid) return;
  usTarget = { uid: otherUid, name: name || nameCache[otherUid] || "User" };
  $("usName").textContent = usTarget.name;
  $("usBlock").textContent = blocksCache[otherUid] ? "Unblock" : "Block";
  $("userSheet").classList.add("open");
}
const closeUserSheet = () => $("userSheet").classList.remove("open");
$("usClose").onclick = closeUserSheet;
$("userSheet").onclick = (e) => { if (e.target.id === "userSheet") closeUserSheet(); };
$("usMsg").onclick = () => {
  const t = usTarget;
  closeUserSheet();
  $("sheet").classList.remove("open");
  if (t) openDm(t.uid, inRoom ? "chat" : "lobby");
};
$("usBlock").onclick = () => {
  const t = usTarget;
  closeUserSheet();
  if (!t) return;
  if (blocksCache[t.uid]) unblockUser(t.uid, t.name);
  else askBlock(t.uid, t.name);
};

// ---- Settings -> Blocked accounts ----
function openBlocked() {
  blockedOpen = true;
  history.pushState({ blocked: true }, "");
  renderBlocked();
  show("blocked");
}
function closeBlocked() {
  blockedOpen = false;
  show("settings");
}
$("blockedRow").onclick = openBlocked;
$("blockedBack").onclick = () => { if (CapApp) closeBlocked(); else history.back(); };
function renderBlocked() {
  const list = $("blockedList");
  const ids = Object.keys(blocksCache);
  list.innerHTML = "";
  $("blockedEmpty").style.display = ids.length ? "none" : "";
  ids.forEach((id) => {
    const row = document.createElement("div"); row.className = "blkRow";
    const av = document.createElement("div"); av.className = "av"; av.textContent = "?";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = "…";
    const btn = document.createElement("button"); btn.className = "smallBtn orange"; btn.textContent = "Unblock";
    row.append(av, nm, btn);
    list.append(row);
    getName(id).then((n) => {
      const name = n || "Unknown user";
      nm.textContent = name; av.textContent = name[0].toUpperCase();
      btn.onclick = () => unblockUser(id, name);
    });
    btn.onclick = () => unblockUser(id, "User");
  });
}

// ---------- Delete account ----------
function closeConfirm() {
  $("confirmSheet").classList.remove("open");
  $("delPassword").value = "";
  $("delConfirm").disabled = false;
}
$("deleteBtn").onclick = () => {
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    toast("Add a password first (⋮ menu → Add password), then you can delete your account.");
    return;
  }
  $("confirmSheet").classList.add("open");
  $("delPassword").focus();
};
$("delCancel").onclick = closeConfirm;

$("delConfirm").onclick = async () => {
  const pw = $("delPassword").value;
  if (!pw) { toast("Enter your password to confirm."); return; }
  $("delConfirm").disabled = true;

  // 1) Prove it is really the owner (Firebase requires a fresh login for this).
  try {
    await reauthenticateWithCredential(
      auth.currentUser, EmailAuthProvider.credential(usernameEmail(myName), pw));
  } catch (e) {
    toast("Wrong password.");
    $("delConfirm").disabled = false;
    return;
  }

  // 2) Remove this user's data, then the login itself. Chat messages are kept.
  try {
    if (inRoom) await leaveChat(false);
    const me = uid, key = myName.toLowerCase();
    for (const room of ROOMS) {
      const mem = room.id + "/members/" + me;
      await remove(ref(db, mem + "/since"));
      await remove(ref(db, mem + "/greeted"));
      await remove(ref(db, mem + "/clearedAt"));
    }
    stopPrivateListeners();
    await remove(ref(db, "inbox/" + me));   // your chat list (the other person keeps their messages)
    await remove(ref(db, "blocks/" + me));
    await remove(ref(db, "names/" + key));
    await remove(ref(db, "users/" + me));
    await deleteUser(auth.currentUser);

    if (lobbyUnsub) { lobbyUnsub(); lobbyUnsub = null; }
    uid = null; myName = null; mySlot = null;
    settingsOpen = false;
    closeConfirm();
    enterLogin();
    toast("Your account was deleted.");
  } catch (e) {
    toast("Couldn't finish deleting. Please try again.");
    $("delConfirm").disabled = false;
  }
};


boot();
