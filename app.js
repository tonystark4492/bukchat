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
  await withTimeout(goOffline(), 3000).catch(() => {});
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
      slotsLive[room.id] = snap.exists() ? snap.val() : {};
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

// Opening a room is made to feel instant: the chat screen appears at once, and the
// membership check, the "seat" in the room and the messages all load in parallel.
const memCache = {}, msgCache = {}, slotsLive = {};
let joinToken = 0, joining = false, slotUids = [];
function openShell() {
  inRoom = true;
  if (lobbyUnsub) { lobbyUnsub(); lobbyUnsub = null; }
  show("chat");
  $("chatTitle").textContent = currentRoom.emoji + " " + currentRoom.name;
  const live = slotsLive[currentRoom.id];
  $("chatSub").textContent = live ? Object.keys(live).length + " online" : "";
  $("msgs").innerHTML = '<div class="skel"><i></i><i></i><i></i></div>'; stick.set($("msgs"), true);
  history.pushState({ chat: true }, "");
}
async function joinRoom(room, btn) {
  if (joining || inRoom) return;
  const live = slotsLive[room.id];
  if (live && Object.keys(live).length >= MAX_MEMBERS && !Object.values(live).includes(uid)) {
    toast(room.name + " is full (" + MAX_MEMBERS + "/" + MAX_MEMBERS + "). Try again later.");
    return;
  }
  joining = true;
  const token = ++joinToken;
  currentRoom = room;
  ROOM = room.id;
  const mkey = uid + "/" + room.id;
  const cachedMem = memCache[mkey];
  openShell();
  const slotP = claimSlot(room.id, mySlot);          // runs while the membership loads
  let membership = cachedMem;
  try {
    if (!membership) membership = await withTimeout(loadMembership(room), 12000);
  } catch (e) {
    if (token === joinToken) {
      joining = false; joinToken++; inRoom = false;
      enterLobby();
      toast("Couldn't open the chat. Check your connection and try again.");
    }
    slotP.then((i) => { if (typeof i === "number") releaseSlot(room.id, i); });
    return;
  }
  if (token !== joinToken) {                           // user pressed back while loading
    slotP.then((i) => { if (typeof i === "number") releaseSlot(room.id, i); });
    return;
  }
  memCache[mkey] = membership;
  joining = false;
  openChat(membership);
  if (cachedMem) {                                     // quietly confirm nothing changed
    loadMembership(room).then((m) => {
      memCache[mkey] = m;
      if (inRoom && currentRoom.id === room.id && currentMembership && m.start > currentMembership.start) resetChatView(m.start);
    }).catch(() => {});
  }
  const slot = await slotP;
  if (token !== joinToken) { if (typeof slot === "number") releaseSlot(room.id, slot); return; }
  if (typeof slot === "number") { mySlot = slot; return; }
  toast(slot === null ? room.name + " is full (" + MAX_MEMBERS + "/" + MAX_MEMBERS + "). Try again later." : "Couldn't open the chat. Check your connection and try again.");
  leaveChat(true);
}
function releaseSlot(rid, i) {
  const r = ref(db, rid + "/slots/" + i);
  onDisconnect(r).cancel().catch(() => {});
  remove(r).catch(() => {});
}

// Takes a free seat in the room. Returns the seat number, null if the room is full,
// or "net" if the connection failed. Starts with seats that look free (we already know from
// the lobby), so it normally needs just one round trip.
async function claimSlot(rid, prefer) {
  let netFail = false;
  const tryOne = async (i) => {
    const r = ref(db, rid + "/slots/" + i);
    try {
      await withTimeout(set(r, uid), 8000);
      onDisconnect(r).remove().catch(() => {});
      return true;
    } catch (e) {
      if (!String(e?.code || e).toUpperCase().includes("PERMISSION")) netFail = true;
      return false;
    }
  };
  if (typeof prefer === "number" && (await tryOne(prefer))) return prefer;
  if (netFail) return "net";
  let live = slotsLive[rid];
  const tried = new Set([prefer]);
  for (let round = 0; round < 2; round++) {
    if (!live || round === 1) {
      try { const sn = await withTimeout(get(ref(db, rid + "/slots")), 8000); live = sn.exists() ? sn.val() : {}; }
      catch (e) { return "net"; }
    }
    for (let i = 0; i < MAX_MEMBERS; i++) {
      if (live[i] || tried.has(i)) continue;
      tried.add(i);
      if (await tryOne(i)) return i;
      if (netFail) return "net";
    }
  }
  return null;
}

let currentMembership = null, msgOff = null;
const pendingKeys = new Set();

// Only messages from this member's visible start onward, newest 100 of those.
// Messages already seen earlier this session are shown instantly from memory, and only
// newer ones are downloaded.
let shownKeys = new Set(), msgQueue = [], msgRaf = 0;
function startMessageListener() {
  if (msgOff) { msgOff(); msgOff = null; }
  shownKeys = new Set(); msgQueue = [];
  const ck = uid + "/" + ROOM, start = currentMembership.start;
  let from = start;
  const c = msgCache[ck];
  if (c && c.start === start && c.items.length) {
    const last = c.items[c.items.length - 1].m.ts;
    if (typeof last === "number") from = Math.max(from, last);
    c.items.forEach((x) => { shownKeys.add(x.key); msgQueue.push([x.m, x.key]); });
    flushMsgs(true);
  } else delete msgCache[ck];
  const q = query(
    ref(db, ROOM + "/messages"),
    orderByChild("ts"),
    startAt(from),
    limitToLast(100)
  );
  msgOff = onChildAdded(q, (snap) => queueMsg(snap.val(), snap.key));
}
function queueMsg(m, key) {
  if (!m || typeof m.text !== "string") return;
  if (key) { if (shownKeys.has(key)) return; shownKeys.add(key); }
  msgQueue.push([m, key]);
  if (!msgRaf) msgRaf = requestAnimationFrame(() => flushMsgs());
}
// Many messages arriving together are drawn in one go (one layout, one scroll).
function flushMsgs(fromCache) {
  msgRaf = 0;
  const items = msgQueue; msgQueue = [];
  if (!items.length || !inRoom) return;
  const box = $("msgs");
  const sk = box.querySelector(".skel"); if (sk) sk.remove();
  const nearBottom = stick.get(box) || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const frag = document.createDocumentFragment();
  const ck = uid + "/" + ROOM;
  const cache = msgCache[ck] || (msgCache[ck] = { start: currentMembership.start, items: [] });
  let anyMine = false;
  items.forEach(([m, key]) => {
    if (m.uid === uid) anyMine = true;
    const el = buildMessage(m, key);
    if (items.length > 3) el.style.animation = "none";
    frag.append(el);
    if (!fromCache && key && typeof m.ts === "number" && !pendingKeys.has(key)) cache.items.push({ key, m });
  });
  if (cache.items.length > 150) cache.items.splice(0, cache.items.length - 150);
  box.append(frag);
  while (box.childElementCount > 300) box.firstElementChild.remove(); // keep the page light
  if (nearBottom || anyMine) box.scrollTop = box.scrollHeight;
}

function openChat(membership) {
  $("msgs").innerHTML = ""; stick.set($("msgs"), true);
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

  unsubs.push(onValue(ref(db, ROOM + "/slots"), (snap) => {
    slotUids = snap.exists() ? Object.values(snap.val()) : [];
    $("memCount").textContent = slotUids.length + "/" + MAX_MEMBERS;
    $("chatSub").textContent = slotUids.length + " online";
    if ($("sheet").classList.contains("open")) renderMembers();   // names are fetched only when the list is opened
  }));

  currentMembership = membership;
  unsubs.push(() => { if (msgOff) { msgOff(); msgOff = null; } });
  startMessageListener();

  let firstConn = true;
  unsubs.push(onValue(ref(db, ".info/connected"), async (s) => {
    if (firstConn) { firstConn = false; return; }      // the seat was just taken while joining
    if (s.val() === true && inRoom) {
      const rid = ROOM, r = await claimSlot(rid, mySlot);
      if (!inRoom || rid !== ROOM) { if (typeof r === "number") releaseSlot(rid, r); return; }
      if (typeof r === "number") mySlot = r;
      else if (r === null) {
        toast(currentRoom.name + " became full. You were moved out.");
        leaveChat(true);
      }
    }
  }));

}

let memRenderId = 0;
async function renderMembers() {
  const my = ++memRenderId, uids = slotUids.slice();
  const names = await Promise.all(uids.map(getName));
  if (my !== memRenderId) return;
  const ul = $("memList");
  ul.innerHTML = "";
  names.forEach((n, i) => {
    const li = document.createElement("li");
    const av = document.createElement("div");
    av.className = "av";
    av.textContent = (n || "?")[0].toUpperCase();
    paintAv(av, uids[i], n);
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

// ---------- Keep the newest message in view ----------
// stick = "the reader is at the bottom". While true, anything that changes the size of the
// chat area (keyboard opening/closing, the message box growing) keeps the bottom in view.
const stick = new WeakMap();
function watchBottom(box) {
  stick.set(box, true);
  box.addEventListener("scroll", () =>
    stick.set(box, box.scrollHeight - box.scrollTop - box.clientHeight < 60), { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (stick.get(box)) box.scrollTop = box.scrollHeight; }).observe(box);
  }
}
watchBottom($("msgs")); watchBottom($("dmMsgs"));
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () =>
    ["msgs", "dmMsgs"].forEach((id) => { const b = $(id); if (stick.get(b)) b.scrollTop = b.scrollHeight; }));
}
// Message box: grows with the text (up to ~5 lines). On a phone the keyboard's Enter key adds a
// new line and the ➤ button sends. With a physical keyboard Enter sends and Shift+Enter adds a line.
function autosize(t) {
  const box = $(t.id === "msgInput" ? "msgs" : "dmMsgs");
  const wasAtBottom = stick.get(box);
  t.style.height = "auto";                       // measure at one line,
  t.style.height = Math.min(t.scrollHeight, 120) + "px";
  if (wasAtBottom) box.scrollTop = box.scrollHeight; // then keep the newest message in view
}
["msgInput", "dmInput"].forEach((id) => {
  const t = $(id);
  t.addEventListener("input", () => autosize(t));
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      t.form.requestSubmit();
    }
  });
  t.addEventListener("focus", () => setTimeout(() => {
    const b = $(id === "msgInput" ? "msgs" : "dmMsgs");
    if (stick.get(b)) b.scrollTop = b.scrollHeight;
  }, 300));
});

function buildMessage(m, key) {
  const mine = m.uid === uid;
  const d = document.createElement("div");
  d.className = "msg " + (mine ? "mine" : "other");
  if (key) d.dataset.key = key;
  const who = document.createElement("div");
  who.className = "who";
  if (m.uid) {
    const mav = document.createElement("div"); mav.className = "av"; mav.textContent = ((m.name || "?")[0] || "?").toUpperCase();
    paintAv(mav, m.uid, m.name); who.append(mav);
  }
  const wn = document.createElement("span"); wn.textContent = m.name || "?"; who.append(wn);
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
  return d;
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
  $("msgInput").value = ""; autosize($("msgInput"));
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
    msgQueue = msgQueue.filter((x) => x[1] !== key);
    const el = document.querySelector('.msg[data-key="' + key + '"]');
    if (el) el.remove();
    toast("Message not sent. Check your connection.");
    $("msgInput").value = text; autosize($("msgInput"));
  }
  $("msgInput").focus();
});

async function leaveChat(fromPop) {
  if (!inRoom) return;
  inRoom = false;
  joinToken++; joining = false;
  msgQueue = [];
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
  if (profileOpen) { closeProfile(); return; }
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
  if (profileOpen) { closeProfile(); return; }
  if (blockedOpen) { closeBlocked(); return; }
  if (settingsOpen) { closeSettings(); return; }
  if (dmOpen) { leaveDm(); return; }
  if (inRoom) leaveChat(true);
});
$("membersBtn").onclick = () => { $("sheet").classList.add("open"); renderMembers(); };
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
  const items = [{ label: "👤  My profile", fn: openProfile }, { label: "⚙️  Settings", fn: openSettings }];
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    items.push({ label: "🔑  Add password", fn: doAddPassword });
  }
  items.push({ label: "Log out", fn: doLogout });
  openMenu($("lobbyMenuBtn"), items);
};
$("chatMenuBtn").onclick = () =>
  openMenu($("chatMenuBtn"), [
    { label: "👤  My profile", fn: openProfile },
    { label: "⚙️  Settings", fn: openSettings },
    { label: "🗑  Delete chat history", danger: true, fn: askClearThisRoom }
  ]);

// ---------- Ready-made avatars (drawn in code: no image files, no storage used) ----------
// Only the avatar's id (like "a7") is saved in the database; the picture is drawn on the phone.
const AV_SKIN = ["#fbe0c8", "#f3c9a0", "#e2a87a", "#c98b5b", "#a8673a", "#8a4f2a", "#6a3b1f", "#4b2a15"];
function avShade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, "0")).join("");
}
function avBg(b) {
  const [k, c1, c2] = b;
  if (k === "grad") return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>`;
  if (k === "sun") return `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="52" r="30" fill="#fff" opacity=".28"/>`;
  if (k === "geo") return `<rect width="100" height="100" fill="${c1}"/><circle cx="82" cy="18" r="26" fill="${c2}" opacity=".55"/><path d="M0 100 L0 52 L46 100Z" fill="${c2}" opacity=".4"/>`;
  if (k === "neon") return `<rect width="100" height="100" fill="#13132b"/><circle cx="50" cy="50" r="45" fill="none" stroke="${c1}" stroke-width="3.5"/><circle cx="50" cy="50" r="38" fill="none" stroke="${c2}" stroke-width="1.2" opacity=".7"/>`;
  if (k === "dots") { let d = ""; for (let y = 10; y < 100; y += 20) for (let x = (y / 20) % 2 ? 10 : 20; x < 100; x += 20) d += `<circle cx="${x}" cy="${y}" r="5" fill="${c2}" opacity=".45"/>`; return `<rect width="100" height="100" fill="${c1}"/>` + d; }
  if (k === "stripe") return `<rect width="100" height="100" fill="${c1}"/><path d="M-10 30 L30 -10 L50 -10 L-10 50Z M-10 70 L70 -10 L90 -10 L-10 90Z M30 110 L110 30 L110 50 L50 110Z M70 110 L110 70 L110 90 L90 110Z" fill="${c2}" opacity=".4"/>`;
  return `<rect width="100" height="100" fill="${c1}"/>`;
}
// hair: {b: behind body, m: over body/behind face, f: in front of face}
function avHair(h, c, S, d) {
  const F = `fill="${c}"${S}`;
  switch (h) {
    case "short": return { f: `<path ${F} d="M32 42 Q30 20 50 20 Q70 20 68 42 Q64 31 50 30 Q36 31 32 42Z"/>` };
    case "quiff": return { f: `<path ${F} d="M31 43 Q27 18 52 18 Q74 18 69 43 Q65 30 54 29 Q40 28 31 43Z"/><ellipse ${F} cx="43" cy="21" rx="12" ry="6"/>` };
    case "side": return { f: `<path ${F} d="M31 44 Q29 19 52 20 Q71 22 69 44 Q62 28 44 31 Q35 33 31 44Z"/>` };
    case "buzz": return { f: `<path d="M32 40 Q31 22 50 21 Q69 22 68 40 Q62 31 50 31 Q38 31 32 40Z" fill="${c}" opacity=".55"/>` };
    case "curly": return { b: `<g ${F}><circle cx="34" cy="38" r="8"/><circle cx="66" cy="38" r="8"/></g>`, f: `<g ${F}><circle cx="36" cy="30" r="8"/><circle cx="45" cy="23" r="8.5"/><circle cx="56" cy="22" r="8.5"/><circle cx="65" cy="29" r="8"/><circle cx="50" cy="29" r="9"/></g>` };
    case "afro": return { b: `<circle ${F} cx="50" cy="38" r="29"/>`, f: `<path d="M33 42 Q34 28 50 27 Q66 28 67 42 Q60 34 50 34 Q40 34 33 42Z" fill="${c}"/>` };
    case "bun": return { f: `<path ${F} d="M32 42 Q30 20 50 20 Q70 20 68 42 Q64 31 50 30 Q36 31 32 42Z"/><circle ${F} cx="50" cy="14" r="7"/>` };
    case "bald": return {};
    case "cap": return { f: `<path d="M31 40 Q30 17 50 17 Q70 17 69 40Z" fill="${d.cap}"${S}/><path d="M31 40 L82 40 Q84 44 78 44 L31 44Z" fill="${avShade(d.cap, .8)}"${S}/>` };
    case "turban": return { m: `<g fill="${d.cap}"${S}><ellipse cx="50" cy="30" rx="23" ry="17"/></g><path d="M29 30 Q50 14 71 30 M28 36 Q50 20 72 36 M32 24 Q52 36 70 24" fill="none" stroke="${avShade(d.cap, .72)}" stroke-width="2.2"/>`, f: "" };
    case "kufi": return { f: `<path d="M34 34 Q34 18 50 18 Q66 18 66 34Z" fill="${d.cap}"${S}/><path d="M36 28 H64 M38 23 H62" stroke="${avShade(d.cap, .7)}" stroke-width="1.6" fill="none"/>` };
    case "long": return { b: `<path ${F} d="M29 44 Q22 82 32 98 L68 98 Q78 82 71 44Z"/>`, f: `<path ${F} d="M31 44 Q28 18 52 19 Q72 20 69 44 Q66 30 52 30 Q38 32 31 44Z"/>` };
    case "wavy": return { b: `<path ${F} d="M29 44 Q20 66 30 76 Q22 88 34 98 L66 98 Q78 88 70 76 Q80 66 71 44Z"/>`, f: `<path ${F} d="M31 44 Q27 18 52 19 Q73 20 69 44 Q58 24 42 36 Q36 40 31 44Z"/>` };
    case "bob": return { b: `<path ${F} d="M29 44 Q26 70 33 74 L67 74 Q74 70 71 44Z"/>`, f: `<path ${F} d="M30 46 Q27 18 52 19 Q73 20 70 46 Q64 32 50 31 Q38 32 30 46Z"/>` };
    case "pony": return { b: `<path ${F} d="M64 30 Q92 30 86 70 Q80 58 72 54Z"/>`, f: `<path ${F} d="M31 44 Q28 18 52 19 Q72 20 69 44 Q65 31 52 30 Q38 32 31 44Z"/>` };
    case "pixie": return { f: `<path ${F} d="M30 46 Q26 18 52 18 Q76 20 70 44 Q60 26 40 34 Q34 38 30 46Z"/>` };
    case "wbun": return { f: `<path ${F} d="M31 44 Q28 18 52 19 Q72 20 69 44 Q65 31 52 30 Q38 32 31 44Z"/><circle ${F} cx="50" cy="12" r="9"/>` };
    case "braids": return { b: `<path ${F} d="M31 44 Q28 52 32 60 L68 60 Q72 52 69 44Z"/>`, m: `<g ${F}><circle cx="30" cy="66" r="4.5"/><circle cx="28" cy="75" r="4.5"/><circle cx="29" cy="84" r="4.5"/><circle cx="70" cy="66" r="4.5"/><circle cx="72" cy="75" r="4.5"/><circle cx="71" cy="84" r="4.5"/></g>`, f: `<path ${F} d="M31 44 Q28 18 52 19 Q72 20 69 44 Q64 31 52 30 Q38 32 31 44Z"/>` };
    case "puffs": return { b: `<g ${F}><circle cx="27" cy="26" r="13"/><circle cx="73" cy="26" r="13"/></g>`, f: `<path ${F} d="M31 44 Q30 22 50 22 Q70 22 69 44 Q64 33 50 32 Q36 33 31 44Z"/>` };
    case "hijab": return { m: `<path d="M25 52 Q22 14 50 14 Q78 14 75 52 Q78 74 72 90 L28 90 Q22 74 25 52Z" fill="${d.cap}"${S}/>`, f: `<path d="M33 40 Q50 24 67 40 Q50 31 33 40Z" fill="${d.cap}"/>` };
  }
  return {};
}
function avPerson(d) {
  const S = d.ol ? ' stroke="#1d1b2e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' : "";
  const skin = AV_SKIN[d.skin], dk = avShade(skin, .82), hc = d.hc || "#222";
  const H = avHair(d.hair, hc, S, d);
  const woman = d.g === "f";
  let body = `<path d="M10 100 Q12 70 50 69 Q88 70 90 100Z" fill="${d.cl}"${S}/>`;
  if (d.ct === "hoodie") body += `<path d="M30 74 Q50 90 70 74 Q50 70 30 74Z" fill="${avShade(d.cl, .78)}"/><path d="M44 82 V92 M56 82 V92" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>`;
  else if (d.ct === "collar") body += `<path d="M40 70 L50 84 L36 80Z M60 70 L50 84 L64 80Z" fill="#fff"${S}/>` + (d.tie ? `<path d="M50 82 L46 100 L54 100Z" fill="${d.tie}"/>` : "");
  else body += `<path d="M40 69 Q50 82 60 69Z" fill="${dk}"/>`;
  const neck = `<path d="M43 56 H57 V72 Q50 80 43 72Z" fill="${dk}"${S ? S : ""}/>`;
  const ears = `<g fill="${skin}"${S}><ellipse cx="32.5" cy="48" rx="3.6" ry="5"/><ellipse cx="67.5" cy="48" rx="3.6" ry="5"/></g>`;
  const face = `<ellipse cx="50" cy="46" rx="17.5" ry="20" fill="${skin}"${S}/>`;
  let ft = "";
  const ey = 47;
  if (d.eyes === "happy") ft += `<path d="M37.5 ${ey + 1} Q42 ${ey - 4} 46.5 ${ey + 1} M53.5 ${ey + 1} Q58 ${ey - 4} 62.5 ${ey + 1}" fill="none" stroke="#222" stroke-width="2" stroke-linecap="round"/>`;
  else if (d.eyes === "wink") ft += `<circle cx="42" cy="${ey}" r="2.5" fill="#222"/><path d="M53.5 ${ey + 1} Q58 ${ey - 4} 62.5 ${ey + 1}" fill="none" stroke="#222" stroke-width="2" stroke-linecap="round"/>`;
  else ft += `<circle cx="42" cy="${ey}" r="2.6" fill="#222"/><circle cx="58" cy="${ey}" r="2.6" fill="#222"/><circle cx="43" cy="${ey - 1}" r=".9" fill="#fff"/><circle cx="59" cy="${ey - 1}" r=".9" fill="#fff"/>`;
  if (woman) ft += `<path d="M38.5 ${ey - 2.5} L36.5 ${ey - 5} M62 ${ey - 5} L61.5 ${ey - 2.5}" stroke="#222" stroke-width="1.4" stroke-linecap="round"/>`;
  ft += `<path d="M37.5 ${ey - 6.5} Q42 ${ey - 8.5} 46 ${ey - 6.5} M54 ${ey - 6.5} Q58 ${ey - 8.5} 62.5 ${ey - 6.5}" fill="none" stroke="${d.hair === "hijab" || d.hair === "bald" || d.hair === "cap" || d.hair === "turban" ? "#3a2a1d" : hc}" stroke-width="1.7" stroke-linecap="round"/>`;
  ft += `<path d="M50 ${ey + 1} Q47.5 ${ey + 7} 51 ${ey + 7.5}" fill="none" stroke="${avShade(skin, .68)}" stroke-width="1.3" stroke-linecap="round"/>`;
  if (d.mouth === "grin") ft += `<path d="M43 56 Q50 66 57 56Z" fill="#fff" stroke="#7a2f2f" stroke-width="1.5" stroke-linejoin="round"/>`;
  else if (woman) ft += `<path d="M44.5 57 Q50 62 55.5 57 Q50 59 44.5 57Z" fill="#d94b6a" stroke="#d94b6a" stroke-width="1.6" stroke-linejoin="round"/>`;
  else ft += `<path d="M44 57 Q50 62 56 57" fill="none" stroke="#7a2f2f" stroke-width="1.8" stroke-linecap="round"/>`;
  if (woman || d.blush) ft += `<circle cx="37" cy="54" r="3.2" fill="#ff7a8a" opacity=".3"/><circle cx="63" cy="54" r="3.2" fill="#ff7a8a" opacity=".3"/>`;
  if (d.fr) ft += `<g fill="${avShade(skin, .7)}" opacity=".8"><circle cx="40" cy="52" r=".9"/><circle cx="43" cy="53.5" r=".9"/><circle cx="38" cy="54.5" r=".9"/><circle cx="60" cy="52" r=".9"/><circle cx="57" cy="53.5" r=".9"/><circle cx="62" cy="54.5" r=".9"/></g>`;
  let beard = "";
  if (d.beard) beard = `<path d="M32.5 50 Q33 69 50 69 Q67 69 67.5 50 Q64 61 50 61 Q36 61 32.5 50Z" fill="${hc}"${S}/><path d="M44 57 Q50 61 56 57" fill="none" stroke="#7a2f2f" stroke-width="1.6" stroke-linecap="round"/>`;
  if (d.stubble) beard = `<path d="M33 50 Q34 68 50 68 Q66 68 67 50 Q64 62 50 62 Q36 62 33 50Z" fill="${hc}" opacity=".35"/>`;
  let glass = "";
  if (d.gl === "round") glass = `<g fill="none" stroke="#2b2b3a" stroke-width="1.8"><circle cx="42" cy="${ey}" r="6.2"/><circle cx="58" cy="${ey}" r="6.2"/><path d="M48.2 ${ey} H51.8 M35.8 ${ey - 1} L32.5 ${ey - 3} M64.2 ${ey - 1} L67.5 ${ey - 3}"/></g>`;
  if (d.gl === "sun") glass = `<g fill="#1b1b2b"><rect x="34" y="${ey - 5}" width="14" height="9" rx="4"/><rect x="52" y="${ey - 5}" width="14" height="9" rx="4"/></g><path d="M48 ${ey - 2} H52" stroke="#1b1b2b" stroke-width="1.8"/><path d="M36 ${ey - 3} L40 ${ey - 3} M54 ${ey - 3} L58 ${ey - 3}" stroke="#fff" stroke-width="1.2" opacity=".6"/>`;
  return avBg(d.bg) + (H.b || "") + body + (H.m || "") + neck + ears + face + ft + beard + (H.f || "") + glass;
}
function avChar(k, c) {
  const eye = (x, y, r = 3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#1b1b2b"/><circle cx="${x + r * .35}" cy="${y - r * .35}" r="${r * .32}" fill="#fff"/>`;
  switch (k) {
    case "robot": return `<line x1="50" y1="24" x2="50" y2="12" stroke="#8a93a6" stroke-width="3"/><circle cx="50" cy="11" r="4.5" fill="#ff4d6d"/><rect x="22" y="40" width="7" height="16" rx="3" fill="#6b7488"/><rect x="71" y="40" width="7" height="16" rx="3" fill="#6b7488"/><rect x="14" y="76" width="72" height="30" rx="14" fill="#8a93a6"/><rect x="27" y="23" width="46" height="46" rx="12" fill="#c9d1e0" stroke="#6b7488" stroke-width="2.5"/><rect x="34" y="36" width="32" height="15" rx="7" fill="#12162a"/><circle cx="42" cy="43.5" r="4.2" fill="#2ef2ff"/><circle cx="58" cy="43.5" r="4.2" fill="#2ef2ff"/><path d="M41 60 H59" stroke="#6b7488" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/>`;
    case "astro": return `<path d="M10 100 Q12 74 50 72 Q88 74 90 100Z" fill="#eef1f8"/><rect x="40" y="82" width="20" height="9" rx="3" fill="#ff7a00"/><circle cx="50" cy="46" r="30" fill="#f3f5fb" stroke="#c4cbe0" stroke-width="2.5"/><ellipse cx="50" cy="46" rx="22" ry="19" fill="#1c2250"/><ellipse cx="42" cy="38" rx="8" ry="4.5" fill="#fff" opacity=".35" transform="rotate(-25 42 38)"/><circle cx="58" cy="54" r="2" fill="#fff" opacity=".5"/><circle cx="46" cy="57" r="1" fill="#fff" opacity=".6"/>`;
    case "ninja": return `<path d="M12 100 Q14 72 50 70 Q86 72 88 100Z" fill="#23233a"/><circle cx="50" cy="46" r="26" fill="#2b2b45"/><rect x="25" y="38" width="50" height="17" rx="8" fill="#f1c9a0"/><path d="M24 33 H76 V40 H24Z" fill="#e5383b"/><path d="M76 34 Q88 32 90 44 Q82 40 76 40Z M76 36 Q90 40 88 52 Q82 46 76 42Z" fill="#e5383b"/><circle cx="41" cy="47" r="3" fill="#1b1b2b"/><circle cx="59" cy="47" r="3" fill="#1b1b2b"/><circle cx="42" cy="46" r=".9" fill="#fff"/><circle cx="60" cy="46" r=".9" fill="#fff"/>`;
    case "fox": return `<path d="M16 16 L40 34 L36 52Z" fill="#f2711c"/><path d="M84 16 L60 34 L64 52Z" fill="#f2711c"/><path d="M22 24 L36 35 L34 44Z M78 24 L64 35 L66 44Z" fill="#2b1b17"/><path d="M50 26 Q86 28 82 58 Q74 84 50 88 Q26 84 18 58 Q14 28 50 26Z" fill="#f2711c"/><path d="M18 58 Q30 62 50 80 Q70 62 82 58 Q74 84 50 88 Q26 84 18 58Z" fill="#fff"/><path d="M50 78 L44 70 Q50 66 56 70Z" fill="#2b1b17"/>${eye(38, 52, 3.2)}${eye(62, 52, 3.2)}`;
    case "panda": return `<circle cx="26" cy="26" r="11" fill="#22222e"/><circle cx="74" cy="26" r="11" fill="#22222e"/><circle cx="50" cy="52" r="30" fill="#fff" stroke="#e0e3ec" stroke-width="2"/><ellipse cx="38" cy="50" rx="7" ry="9" fill="#22222e" transform="rotate(25 38 50)"/><ellipse cx="62" cy="50" rx="7" ry="9" fill="#22222e" transform="rotate(-25 62 50)"/><circle cx="38.5" cy="49" r="2.4" fill="#fff"/><circle cx="61.5" cy="49" r="2.4" fill="#fff"/><ellipse cx="50" cy="60" rx="4.5" ry="3.2" fill="#22222e"/><path d="M45 66 Q50 70 55 66" fill="none" stroke="#22222e" stroke-width="2" stroke-linecap="round"/>`;
    case "cat": return `<path d="M20 18 L44 34 L24 56Z" fill="#8f9bb3"/><path d="M80 18 L56 34 L76 56Z" fill="#8f9bb3"/><path d="M25 27 L38 36 L28 46Z M75 27 L62 36 L72 46Z" fill="#ffb3c1"/><ellipse cx="50" cy="56" rx="31" ry="27" fill="#8f9bb3"/><path d="M50 30 V40 M42 32 L44 40 M58 32 L56 40" stroke="#6f7b94" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="38" cy="54" rx="5" ry="6" fill="#d9f99d"/><ellipse cx="62" cy="54" rx="5" ry="6" fill="#d9f99d"/><ellipse cx="38" cy="54" rx="1.8" ry="5" fill="#1b1b2b"/><ellipse cx="62" cy="54" rx="1.8" ry="5" fill="#1b1b2b"/><path d="M47 65 L53 65 L50 69Z" fill="#ff8fa3"/><path d="M50 69 Q46 74 42 71 M50 69 Q54 74 58 71" fill="none" stroke="#475068" stroke-width="1.8" stroke-linecap="round"/><path d="M14 62 L30 64 M14 70 L30 68 M86 62 L70 64 M86 70 L70 68" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`;
    case "alien": return `<path d="M50 14 Q90 18 80 56 Q72 86 50 88 Q28 86 20 56 Q10 18 50 14Z" fill="#7bdc5a" stroke="#4fae38" stroke-width="2.5"/><ellipse cx="36" cy="48" rx="10" ry="14" fill="#161629" transform="rotate(20 36 48)"/><ellipse cx="64" cy="48" rx="10" ry="14" fill="#161629" transform="rotate(-20 64 48)"/><ellipse cx="33" cy="43" rx="2.8" ry="4" fill="#fff" opacity=".85" transform="rotate(20 33 43)"/><ellipse cx="67" cy="43" rx="2.8" ry="4" fill="#fff" opacity=".85" transform="rotate(-20 67 43)"/><path d="M45 72 Q50 75 55 72" fill="none" stroke="#2e7a22" stroke-width="2" stroke-linecap="round"/>`;
    case "bear": return `<circle cx="24" cy="26" r="11" fill="#9a6a45"/><circle cx="76" cy="26" r="11" fill="#9a6a45"/><circle cx="24" cy="26" r="5.5" fill="#d7a981"/><circle cx="76" cy="26" r="5.5" fill="#d7a981"/><circle cx="50" cy="52" r="31" fill="#b07a50"/><ellipse cx="50" cy="62" rx="14" ry="11" fill="#e7c6a0"/><ellipse cx="50" cy="57" rx="5.5" ry="4" fill="#3a2418"/><path d="M50 61 V65 M45 67 Q50 71 55 67" fill="none" stroke="#3a2418" stroke-width="2" stroke-linecap="round"/>${eye(37, 46, 3.4)}${eye(63, 46, 3.4)}`;
  }
  return "";
}
// id, group (m/f/c), what to draw
const M = (o) => Object.assign({ g: "m", ct: "tee", eyes: "dot", mouth: "smile" }, o);
const W = (o) => Object.assign({ g: "f", ct: "tee", eyes: "dot", mouth: "smile" }, o);
const AVATARS = [
  M({ skin: 2, hair: "short", hc: "#2b1d14", cl: "#3b82f6", bg: ["grad", "#a5f3fc", "#6366f1"] }),
  M({ skin: 0, hair: "quiff", hc: "#7a4a21", cl: "#ef4444", ct: "hoodie", bg: ["flat", "#fde047"], ol: 1, eyes: "happy", mouth: "grin" }),
  M({ skin: 5, hair: "curly", hc: "#161616", cl: "#10b981", bg: ["geo", "#5eead4", "#0d9488"], gl: "round" }),
  M({ skin: 3, hair: "buzz", hc: "#222", cl: "#8b5cf6", ct: "collar", beard: 1, bg: ["neon", "#a78bfa", "#22d3ee"] }),
  M({ skin: 6, hair: "afro", hc: "#111", cl: "#f59e0b", ct: "hoodie", bg: ["sun", "#fb7185", "#fbbf24"], gl: "sun", mouth: "grin" }),
  M({ skin: 1, hair: "side", hc: "#c9a227", cl: "#0ea5e9", ct: "collar", tie: "#1e3a8a", bg: ["dots", "#fbcfe8", "#f472b6"], ol: 1, eyes: "wink" }),
  M({ skin: 2, hair: "bun", hc: "#5b3a1e", cl: "#14532d", beard: 1, bg: ["stripe", "#fcd34d", "#f97316"] }),
  M({ skin: 4, hair: "cap", cap: "#dc2626", hc: "#222", cl: "#ffffff", bg: ["grad", "#fde68a", "#fb923c"], mouth: "grin", eyes: "happy" }),
  M({ skin: 3, hair: "turban", cap: "#f97316", hc: "#e5e7eb", cl: "#1e3a8a", ct: "collar", beard: 1, bg: ["flat", "#fef3c7"], ol: 1 }),
  M({ skin: 5, hair: "kufi", cap: "#f8fafc", hc: "#2b1d14", cl: "#065f46", ct: "collar", beard: 1, bg: ["geo", "#86efac", "#16a34a"] }),
  M({ skin: 7, hair: "bald", hc: "#111", cl: "#6366f1", stubble: 1, bg: ["neon", "#f472b6", "#fbbf24"], gl: "round", mouth: "grin" }),
  M({ skin: 0, hair: "side", hc: "#c2410c", cl: "#64748b", ct: "hoodie", fr: 1, bg: ["grad", "#e9d5ff", "#a78bfa"], ol: 1 }),
  W({ skin: 1, hair: "long", hc: "#3a2a1d", cl: "#ec4899", bg: ["grad", "#fbcfe8", "#f472b6"] }),
  W({ skin: 3, hair: "bob", hc: "#111", cl: "#14b8a6", ct: "collar", bg: ["flat", "#fed7aa"], ol: 1, eyes: "happy" }),
  W({ skin: 5, hair: "pony", hc: "#1f1f1f", cl: "#f59e0b", ct: "hoodie", bg: ["geo", "#c4b5fd", "#7c3aed"] }),
  W({ skin: 0, hair: "pixie", hc: "#f472b6", cl: "#111827", bg: ["neon", "#22d3ee", "#a78bfa"], eyes: "wink" }),
  W({ skin: 2, hair: "wbun", hc: "#7c2d12", cl: "#22c55e", bg: ["sun", "#fde047", "#fb923c"], gl: "round" }),
  W({ skin: 6, hair: "braids", hc: "#111", cl: "#a855f7", ct: "collar", bg: ["stripe", "#7dd3fc", "#0284c7"], mouth: "grin" }),
  W({ skin: 7, hair: "puffs", hc: "#0b0b0b", cl: "#f97316", ct: "hoodie", bg: ["dots", "#fef08a", "#facc15"], ol: 1, eyes: "happy" }),
  W({ skin: 3, hair: "hijab", cap: "#0ea5e9", hc: "#3a2a1d", cl: "#0369a1", bg: ["grad", "#99f6e4", "#14b8a6"] }),
  W({ skin: 1, hair: "hijab", cap: "#be185d", hc: "#3a2a1d", cl: "#831843", bg: ["flat", "#ffe4e6"], ol: 1, eyes: "happy" }),
  W({ skin: 0, hair: "wavy", hc: "#ea580c", cl: "#3b82f6", fr: 1, bg: ["grad", "#bae6fd", "#818cf8"] }),
  W({ skin: 2, hair: "bob", hc: "#eab308", cl: "#ef4444", ct: "collar", bg: ["geo", "#fecaca", "#f87171"], gl: "round" }),
  W({ skin: 4, hair: "long", hc: "#5b21b6", cl: "#0f172a", ct: "hoodie", bg: ["neon", "#e879f9", "#38bdf8"], mouth: "grin" }),
  { g: "c", k: "robot", bg: ["grad", "#c7d2fe", "#6366f1"] },
  { g: "c", k: "astro", bg: ["neon", "#38bdf8", "#a78bfa"] },
  { g: "c", k: "ninja", bg: ["flat", "#fecaca"] },
  { g: "c", k: "fox", bg: ["grad", "#bbf7d0", "#34d399"] },
  { g: "c", k: "panda", bg: ["geo", "#a7f3d0", "#10b981"] },
  { g: "c", k: "cat", bg: ["sun", "#c4b5fd", "#f9a8d4"] },
  { g: "c", k: "alien", bg: ["stripe", "#312e81", "#6366f1"] },
  { g: "c", k: "bear", bg: ["dots", "#fde68a", "#f59e0b"] }
];
const avCache = {};
function avatarURL(id) {
  if (avCache[id]) return avCache[id];
  const d = AVATARS[Number(String(id).slice(1)) - 1];
  if (!d) return "";
  const inner = d.g === "c" ? avBg(d.bg) + avChar(d.k) : avPerson(d);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
  return (avCache[id] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
}

// ---------- Profiles: picture or avatar ----------
//   profiles/<uid> = { av: "a7" }  (a ready-made avatar)   or   { ph: "data:image/jpeg;base64,..." } (small photo)
// A photo is shrunk to 128x128 on the phone first (about 5-8 KB), so it fits in the free database.
const profCache = {};
function getProfile(u, force) {
  const c = profCache[u];
  if (c && !force && Date.now() - c.t < 10 * 60 * 1000) return c.p;
  const p = get(ref(db, "profiles/" + u)).then((s) => (s.exists() ? s.val() : null)).catch(() => null);
  profCache[u] = { t: Date.now(), p };
  return p;
}
const phURLs = new Map();
function phSrc(d) {            // a short blob: address instead of the long data string (lighter when shown many times)
  let u = phURLs.get(d);
  if (!u) {
    try {
      const bin = atob(d.split(",")[1]), a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      u = URL.createObjectURL(new Blob([a], { type: "image/jpeg" }));
    } catch (e) { u = d; }
    phURLs.set(d, u);
  }
  return u;
}
function avSrc(p) { return p ? (p.ph ? phSrc(p.ph) : (p.av ? avatarURL(p.av) : "")) : ""; }
function drawAv(el, p, name) {
  const src = avSrc(p);
  el.textContent = "";
  if (src) { const im = document.createElement("img"); im.alt = ""; im.decoding = "async"; im.src = src; el.append(im); }
  else el.textContent = ((name || "?")[0] || "?").toUpperCase();
}
// Fill any ".av" element with the person's picture (falls back to their first letter).
function paintAv(el, u, name) {
  if (!el || !u) return;
  el.dataset.pu = u;
  if (name !== undefined) el.dataset.pn = name || "";
  getProfile(u).then((p) => { if (el.dataset.pu === u) drawAv(el, p, el.dataset.pn); });
}
function repaintAll(u) {
  document.querySelectorAll('.av[data-pu="' + u + '"]').forEach((el) => {
    getProfile(u).then((p) => drawAv(el, p, el.dataset.pn));
  });
}

let profileOpen = false, profileReturn = "lobby", pfDraft = null, pfSaved = null, pfFilter = "all";
const pfSame = (a, b) => (a && a.av) === (b && b.av) && (a && a.ph) === (b && b.ph);
function pfRender() {
  drawAv($("pfBig"), pfDraft, myName);
  $("pfName").textContent = myName || "";
  const changed = !pfSame(pfDraft, pfSaved);
  $("pfBar").hidden = !changed;
  $("pfRemove").disabled = !pfDraft;
  $("pfHint").textContent = changed ? "Preview — tap Save to keep it" : pfDraft ? (pfDraft.ph ? "Your photo" : "Your avatar") : "No picture yet. Upload a photo or pick an avatar.";
  $("avGrid").querySelectorAll("button").forEach((b) => b.classList.toggle("on", !!pfDraft && pfDraft.av === b.dataset.id));
}
function pfBuildGrid() {
  const g = $("avGrid"); g.innerHTML = "";
  AVATARS.forEach((d, i) => {
    if (pfFilter !== "all" && d.g !== pfFilter) return;
    const id = "a" + (i + 1);
    const b = document.createElement("button");
    b.dataset.id = id; b.setAttribute("aria-label", "Avatar " + (i + 1));
    const im = document.createElement("img"); im.src = avatarURL(id); im.alt = ""; im.loading = "lazy";
    b.append(im);
    b.onclick = () => { pfDraft = { av: id }; pfRender(); };
    g.append(b);
  });
}
$("pfTabs").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  pfFilter = b.dataset.f;
  $("pfTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  pfBuildGrid(); pfRender();
};
async function openProfile() {
  const active = document.querySelector(".screen.active");
  profileReturn = active && active.id !== "profile" ? active.id : "lobby";
  profileOpen = true;
  history.pushState({ profile: true }, "");
  pfSaved = null; pfDraft = null; pfFilter = "all";
  $("pfTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.f === "all"));
  pfBuildGrid(); pfRender();
  show("profile");
  const p = await getProfile(uid, true);
  if (!profileOpen) return;
  pfSaved = p; pfDraft = p; pfRender();
}
function closeProfile() {
  profileOpen = false;
  show(profileReturn);
}
$("profileBack").onclick = () => { if (CapApp) closeProfile(); else history.back(); };
$("pfCancel").onclick = () => { pfDraft = pfSaved; pfRender(); };
$("pfRemove").onclick = () => { pfDraft = null; pfRender(); };
$("pfUpload").onclick = () => $("pfFile").click();
// Shrink + centre-crop the chosen picture to a small square JPEG.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      try {
        const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
        const side = Math.min(im.naturalWidth, im.naturalHeight);
        const sx = (im.naturalWidth - side) / 2, sy = (im.naturalHeight - side) / 2;
        const cx = cv.getContext("2d");
        cx.fillStyle = "#fff"; cx.fillRect(0, 0, S, S);
        cx.drawImage(im, sx, sy, side, side, 0, 0, S, S);
        let q = 0.78, out = cv.toDataURL("image/jpeg", q);
        while (out.length > 14000 && q > 0.3) { q -= 0.1; out = cv.toDataURL("image/jpeg", q); }
        URL.revokeObjectURL(url);
        out.startsWith("data:image/jpeg") ? resolve(out) : reject(new Error("format"));
      } catch (e) { reject(e); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    im.src = url;
  });
}
$("pfFile").onchange = async () => {
  const f = $("pfFile").files && $("pfFile").files[0];
  $("pfFile").value = "";
  if (!f) return;
  if (!/^image\//.test(f.type)) { toast("Please choose a picture."); return; }
  try { pfDraft = { ph: await shrinkPhoto(f) }; pfRender(); }
  catch (e) { toast("Couldn't use that picture. Try another one."); }
};
$("pfSave").onclick = async () => {
  $("pfSave").disabled = true;
  try {
    const r = ref(db, "profiles/" + uid);
    if (pfDraft) await withTimeout(set(r, pfDraft.ph ? { ph: pfDraft.ph } : { av: pfDraft.av }), 10000);
    else await withTimeout(remove(r), 10000);
    profCache[uid] = { t: Date.now(), p: Promise.resolve(pfDraft) };
    pfSaved = pfDraft; pfRender(); repaintAll(uid);
    toast("Profile saved ✓");
  } catch (e) { toast("Couldn't save. Check your connection."); }
  $("pfSave").disabled = false;
};

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
  delete memCache[uid + "/" + room.id]; delete msgCache[uid + "/" + room.id];
  const cRef = ref(db, room.id + "/members/" + uid + "/clearedAt");
  await set(cRef, serverTimestamp());
  return Number((await get(cRef)).val()) || Date.now();
}
function resetChatView(start) {
  if (!inRoom || !currentMembership) return;
  currentMembership.start = Math.max(currentMembership.start, start);
  delete msgCache[uid + "/" + ROOM];
  $("msgs").innerHTML = ""; stick.set($("msgs"), true);
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
  startPresence();
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
    renderChats(); renderBlocked(); updateBadge(); updateDmComposer(); updateDmStatus();
  }, () => {});
}
function stopPrivateListeners() {
  if (inboxOff) { inboxOff(); inboxOff = null; }
  if (blocksOff) { blocksOff(); blocksOff = null; }
  if (dmOff) { dmOff(); dmOff = null; }
  if (connOff) { connOff(); connOff = null; }
  Object.values(peerOff).forEach((f) => f()); peerOff = {}; peerPresence = {};
  stopTypingWatch(); clearTimeout(typingIdleTimer); lastTypingSent = 0;
  inboxCache = {}; blocksCache = {}; inboxReady = false;
  Object.keys(msgCache).forEach((k) => delete msgCache[k]); Object.keys(memCache).forEach((k) => delete memCache[k]);
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
    const wrap = document.createElement("div"); wrap.className = "avWrap";
    const dot = document.createElement("span"); dot.className = "onl";
    const pp = peerPresence[e.with];
    dot.hidden = !(activityOn && pp && pp.online);
    wrap.append(av, dot);
    b.dataset.other = e.with;
    b.append(wrap, mid, rt);
    watchPeer(e.with);
    b.onclick = () => openDm(e.with, "lobby");
    list.append(b);
    getName(e.with).then((n) => {
      nm.textContent = n || "Unknown user";
      av.textContent = (n || "?")[0].toUpperCase();
      paintAv(av, e.with, n);
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
  $("dmMsgs").innerHTML = ""; stick.set($("dmMsgs"), true);
  $("dmTitle").textContent = dmName || "…";
  $("dmAv").textContent = (dmName || "?")[0].toUpperCase();
  paintAv($("dmAv"), other, dmName);
  show("dm");
  updateDmComposer();
  stopTypingWatch(); watchPeer(other); updateDmStatus();
  const conv = dmConvId;
  getName(other).then((n) => {
    if (dmOther !== other) return;
    dmName = n || "Unknown user";
    $("dmTitle").textContent = dmName;
    $("dmAv").textContent = dmName[0].toUpperCase();
    paintAv($("dmAv"), other, dmName);
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
  startTypingWatch();
  markDmSeen();
  if (!blocksCache[other]) setTimeout(() => { if (dmOpen) $("dmInput").focus(); }, 250);
}

function leaveDm() {
  if (!dmOpen) return;
  dmOpen = false;
  clearMyTyping(dmConvId); stopTypingWatch();
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
  const nearBottom = stick.get(box) || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
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
  $("dmInput").value = ""; autosize($("dmInput"));
  clearMyTyping(dmConvId);
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
    if (dmConvId === conv) { $("dmInput").value = text; autosize($("dmInput")); }
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
  $("usAv").textContent = (usTarget.name[0] || "?").toUpperCase();
  paintAv($("usAv"), otherUid, usTarget.name);
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
      nm.textContent = name; av.textContent = name[0].toUpperCase(); paintAv(av, id, name);
      btn.onclick = () => unblockUser(id, name);
    });
    btn.onclick = () => unblockUser(id, "User");
  });
}

// ---------- Online status, last seen and typing ----------
//   presence/<uid>            {online, last}  written only by its owner; readable by people you have
//                                              chatted with (and nobody who is blocked)
//   dms/<conv>/typing/<uid>   server time of the last keystroke burst (removed when done)
// One switch (Settings) controls all three. If it is off you publish nothing and see nothing.
let activityOn = true;
try { activityOn = localStorage.getItem("bukchat-activity") !== "off"; } catch (e) {}
let connOff = null, isConnected = false, peerOff = {}, peerPresence = {};
let peerTyping = false, typingOff = null, peerTypingTimer = null, lastTypingSent = 0, typingIdleTimer = null;
const myPresenceRef = () => ref(db, "presence/" + uid);
const typingRef = (conv, u) => ref(db, "dms/" + conv + "/typing/" + u);

function publishPresence(online) {
  if (!uid || !activityOn || !connOff || !isConnected) return;
  set(myPresenceRef(), { online, last: serverTimestamp() }).catch(() => {});
}
function startPresence() {
  if (connOff || !uid) return;
  connOff = onValue(ref(db, ".info/connected"), async (s) => {
    isConnected = s.val() === true;
    if (!isConnected || !uid) return;
    try {
      if (activityOn) {
        // If the phone loses its connection the server marks me offline by itself.
        await onDisconnect(myPresenceRef()).set({ online: false, last: serverTimestamp() });
        publishPresence(!document.hidden);
      } else {
        await onDisconnect(myPresenceRef()).cancel();
        await remove(myPresenceRef());
      }
    } catch (e) {}
  });
}
async function goOffline() {
  if (!uid || !connOff || !activityOn) return;
  clearMyTyping(dmConvId);
  try {
    await onDisconnect(myPresenceRef()).cancel();
    await set(myPresenceRef(), { online: false, last: serverTimestamp() });
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearMyTyping(dmConvId); publishPresence(false); } else publishPresence(true);
});
if (CapApp && CapApp.addListener) {
  CapApp.addListener("appStateChange", (st) => {
    if (!st.isActive) clearMyTyping(dmConvId);
    publishPresence(!!st.isActive);
  });
}

function watchPeer(other) {
  if (!other || !activityOn || peerOff[other] || Object.keys(peerOff).length >= 40) return;
  peerOff[other] = onValue(ref(db, "presence/" + other), (s) => {
    peerPresence[other] = s.exists() ? s.val() : null;
    refreshStatusUI(other);
  }, () => { peerPresence[other] = null; refreshStatusUI(other); });
}
function refreshStatusUI(other) {
  if (dmOpen && dmOther === other) updateDmStatus();
  const p = peerPresence[other];
  document.querySelectorAll('.dmItem[data-other="' + other + '"] .onl').forEach((d) => {
    d.hidden = !(activityOn && p && p.online);
  });
}
function fmtLastSeen(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "last seen today at " + time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "last seen yesterday at " + time;
  return "last seen " + d.toLocaleDateString([], { day: "numeric", month: "short" });
}
function updateDmStatus() {
  const el = $("dmSub");
  if (!el || !dmOpen) return;
  const p = peerPresence[dmOther], hidden = !activityOn || !!blocksCache[dmOther];
  let text = "Private chat", cls = "s";
  if (!hidden && peerTyping) { text = "typing…"; cls = "s typing"; }
  else if (!hidden && p) {
    if (p.online) { text = "online"; cls = "s online"; }
    else if (p.last) text = fmtLastSeen(p.last);
  }
  el.textContent = text; el.className = cls;
}

// Typing: I write a timestamp at most every 2.5 s while typing; the other side just notices
// that it changed and shows "typing…" for 5 s (no clock comparison needed).
function startTypingWatch() {
  stopTypingWatch();
  if (!dmConvId || !dmOther || !activityOn) return;
  let first = true;
  typingOff = onValue(typingRef(dmConvId, dmOther), (s) => {
    if (first) { first = false; return; }          // ignore anything left over from before I opened the chat
    clearTimeout(peerTypingTimer);
    if (!s.exists()) peerTyping = false;
    else {
      peerTyping = true;
      peerTypingTimer = setTimeout(() => { peerTyping = false; updateDmStatus(); }, 5000);
    }
    updateDmStatus();
  }, () => {});
}
function stopTypingWatch() {
  if (typingOff) { typingOff(); typingOff = null; }
  clearTimeout(peerTypingTimer);
  peerTyping = false;
}
function sendTyping() {
  if (!activityOn || !dmConvId || !dmOther || blocksCache[dmOther]) return;
  const now = Date.now(), conv = dmConvId;
  if (now - lastTypingSent > 2500) {
    lastTypingSent = now;
    const r = typingRef(conv, uid);
    onDisconnect(r).remove().catch(() => {});
    set(r, serverTimestamp()).catch(() => {});
  }
  clearTimeout(typingIdleTimer);
  typingIdleTimer = setTimeout(() => clearMyTyping(conv), 4000);
}
function clearMyTyping(conv) {
  clearTimeout(typingIdleTimer);
  const had = lastTypingSent;
  lastTypingSent = 0;
  if (had && conv && uid) remove(typingRef(conv, uid)).catch(() => {});
}
$("dmInput").addEventListener("input", () => {
  if ($("dmInput").value.trim()) sendTyping(); else clearMyTyping(dmConvId);
});
$("dmInput").addEventListener("blur", () => clearMyTyping(dmConvId));

// Settings switch
function renderActivityBtn() { $("presenceToggle").textContent = activityOn ? "On" : "Off"; }
async function applyActivity() {
  renderActivityBtn();
  if (!uid || !db) return;
  if (!activityOn) {
    clearMyTyping(dmConvId); stopTypingWatch();
    Object.values(peerOff).forEach((f) => f()); peerOff = {}; peerPresence = {};
    try { await onDisconnect(myPresenceRef()).cancel(); await remove(myPresenceRef()); } catch (e) {}
  } else {
    try { await onDisconnect(myPresenceRef()).set({ online: false, last: serverTimestamp() }); } catch (e) {}
    publishPresence(!document.hidden);
    if (dmOpen) { watchPeer(dmOther); startTypingWatch(); }
  }
  renderChats(); updateDmStatus();
}
$("presenceToggle").onclick = () => {
  activityOn = !activityOn;
  try { localStorage.setItem("bukchat-activity", activityOn ? "on" : "off"); } catch (e) {}
  applyActivity();
};
renderActivityBtn();

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
    await remove(ref(db, "profiles/" + me));
    try { await onDisconnect(ref(db, "presence/" + me)).cancel(); } catch (e) {}
    await remove(ref(db, "presence/" + me));
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
