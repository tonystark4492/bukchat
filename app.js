import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, EmailAuthProvider, linkWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  reauthenticateWithCredential, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, onChildAdded, remove,
  onDisconnect, serverTimestamp, query, limitToLast, orderByChild, startAt, update, onChildRemoved
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
  watchRoomNotif(room);
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
  const offAdd = onChildAdded(q, (snap) => queueMsg(snap.val(), snap.key));
  const offRem = onChildRemoved(q, (snap) => removeMsgEl({ t: "r", id: ROOM }, snap.key));
  msgOff = () => { offAdd(); offRem(); };
  loadHidden({ t: "r", id: ROOM });
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
    if (isHidden({ t: "r", id: ROOM }, key)) return;      // I deleted this one "for me"
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
watchBottom($("msgs")); watchBottom($("dmMsgs")); watchBottom($("gMsgs"));
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () =>
    ["msgs", "dmMsgs", "gMsgs"].forEach((id) => { const b = $(id); if (stick.get(b)) b.scrollTop = b.scrollHeight; }));
}
// Message box: grows with the text (up to ~5 lines). On a phone the keyboard's Enter key adds a
// new line and the ➤ button sends. With a physical keyboard Enter sends and Shift+Enter adds a line.
function autosize(t) {
  if (t.form) t.form.classList.toggle("hasText", !!t.value.trim());   // mic when empty, ➤ when there is text
  const box = $(inputBox(t.id));
  const wasAtBottom = stick.get(box);
  t.style.height = "auto";                       // measure at one line,
  t.style.height = Math.min(t.scrollHeight, 120) + "px";
  if (wasAtBottom) box.scrollTop = box.scrollHeight; // then keep the newest message in view
}
const inputBox = (id) => (id === "msgInput" ? "msgs" : id === "dmInput" ? "dmMsgs" : "gMsgs");
["msgInput", "dmInput", "gInput"].forEach((id) => {
  const t = $(id);
  t.addEventListener("input", () => autosize(t));
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      t.form.requestSubmit();
    }
  });
  t.addEventListener("focus", () => setTimeout(() => {
    const b = $(inputBox(id));
    if (stick.get(b)) b.scrollTop = b.scrollHeight;
  }, 300));
});

function buildMessage(m, key, sc) {
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
  const rScope = sc || { t: "r", id: ROOM };
  const body = m.k ? mediaBody(m, key, rScope, d) : textBody(m.text);
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
  if (typeof m.rt === "string" && m.rt) d.append(who, quoteEl(m, rScope), body, tm); else d.append(who, body, tm);
  decorateMsg(d, m, key, rScope, mine, m.uid, m.name);
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
  const rx = takeReply({ t: "r", id: ROOM });
  pendingKeys.add(key);
  try {
    await set(msgRef, Object.assign({ uid, name: myName, text, ts: serverTimestamp() }, rx));
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
  cancelRec(); stopAllAudio(); clearReply(); closeMsgSheets();
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
  for (const id of ["confirmSheet", "clearSheet", "userSheet", "sheet", "stViewers"]) {
    if ($(id).classList.contains("open")) { $(id).classList.remove("open"); pauseSt(false); return; }
  }
  if (closeMsgSheets()) return;
  if (closeMediaOverlays()) return;
  if (sv) { closeStoryView(); return; }
  if (snOpen) { closeStoryNew(); return; }
  if (profileOpen) { closeProfile(); return; }
  if (blockedOpen) { closeBlocked(); return; }
  if (settingsOpen) { closeSettings(); return; }
  if (grpInfoOpen) { closeGroupInfo(); return; }
  if (grpOpen) { leaveGroup(); return; }
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
  if (ignorePops > 0) { ignorePops--; return; }
  if (closeMediaOverlays(true)) return;
  if ($("stViewers").classList.contains("open")) { $("stViewers").classList.remove("open"); pauseSt(false); return; }
  if (sv) { closeStoryView(true); return; }
  if (snOpen) { closeStoryNew(true); return; }
  if (profileOpen) { closeProfile(); return; }
  if (blockedOpen) { closeBlocked(); return; }
  if (settingsOpen) { closeSettings(); return; }
  if (grpInfoOpen) { closeGroupInfo(); return; }
  if (grpOpen) { leaveGroup(); return; }
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
  $("tabStories").classList.toggle("on", t === "stories");
  $("roomsPane").hidden = t !== "rooms";
  $("chatsPane").hidden = t !== "chats";
  $("storiesPane").hidden = t !== "stories";
  if (t === "chats") refreshGroups(false);          // group names/previews are read when this tab opens
  if (t === "stories") loadStories(false);          // stories are fetched only when this tab opens
}
$("tabRooms").onclick = () => setTab("rooms");
$("tabChats").onclick = () => setTab("chats");
$("tabStories").onclick = () => setTab("stories");

const unreadOf = (e) => Math.max(0, (Number(e.n) || 0) - (Number(e.seen) || 0));
const dmVisible = (e) => e && e.with && e.ts && e.ts > (Number(e.clearedAt) || 0) && !blocksCache[e.with];

function startPrivateListeners() {
  if (inboxOff || !uid) return;
  startPresence();
  initNotifs(); startRoomNotifs(); startGroupList();
  inboxReady = false;
  inboxOff = onValue(ref(db, "inbox/" + uid), (snap) => {
    const next = snap.val() || {};
    if (inboxReady) {
      for (const c of Object.keys(next)) {
        const e = next[c], was = inboxCache[c];
        if ((Number(e.n) || 0) > ((was && Number(was.n)) || 0) && e.with &&
            e.from !== uid && !blocksCache[e.with]) {
          getName(e.with).then((nm) => notifyIncoming({ kind: "dm", key: c, from: e.with, name: nm || "Someone", text: e.last || "New message" }));
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
  stopGroupList(); grpOpen = false; grpInfoOpen = false; grpId = null; grpOffs.forEach((f) => { try { f(); } catch (e) {} }); grpOffs = [];
  stopRoomNotifs();
  Object.keys(msgCache).forEach((k) => delete msgCache[k]); Object.keys(memCache).forEach((k) => delete memCache[k]);
  stLoadedAt = 0; stUsers = []; stMine = []; Object.keys(stCache).forEach((k) => delete stCache[k]);
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
  $("dmEmpty").style.display = items.length || Object.keys(grpList).length ? "none" : "";
  updateDmLabel(items.length);
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
  loadHidden({ t: "d", id: conv });
  const offA = onChildAdded(q, (snap) => addDmMessage(snap.val(), snap.key),
    () => { if (dmConvId === conv) toast("Can't open this chat right now."); });
  const offR = onChildRemoved(q, (snap) => { if (dmConvId === conv) removeMsgEl({ t: "d", id: conv }, snap.key); });
  dmOff = () => { offA(); offR(); };
  startTypingWatch();
  markDmSeen();
  if (!blocksCache[other]) setTimeout(() => { if (dmOpen) $("dmInput").focus(); }, 250);
}

function leaveDm() {
  if (!dmOpen) return;
  dmOpen = false;
  cancelRec(); stopAllAudio(); clearReply(); closeMsgSheets();
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
  const dScope = { t: "d", id: dmConvId };
  if (isHidden(dScope, key)) return;                      // I deleted this one "for me"
  const d = document.createElement("div");
  d.className = "msg " + (mine ? "mine" : "other");
  if (key) d.dataset.key = key;
  const body = m.k ? mediaBody(m, key, dScope, d) : textBody(m.text);
  const tm = document.createElement("div");
  tm.className = "tm";
  tm.textContent = m.ts ? fmtTime(m.ts) : "";
  if (mine) {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = pendingKeys.has(key) ? " 🕓" : " ✓";
    tm.append(tick);
  }
  if (typeof m.rt === "string" && m.rt) d.append(quoteEl(m, dScope), body, tm); else d.append(body, tm);
  decorateMsg(d, m, key, dScope, mine, m.from, mine ? myName : dmName);
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

// One private message, written together with both chat-list entries (also used for story replies).
async function dmWrite(conv, other, key, text, extra, more) {
  for (let attempt = 0; attempt < 2; attempt++) {
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
      u["dms/" + conv + "/messages/" + key] = Object.assign({ from: uid, text, ts }, extra || {});
      if (more) Object.assign(u, more);
      u[mine + "with"] = other; u[mine + "last"] = preview; u[mine + "from"] = uid; u[mine + "ts"] = ts; u[mine + "sent"] = n;
      u[theirs + "with"] = uid; u[theirs + "last"] = preview; u[theirs + "from"] = uid; u[theirs + "ts"] = ts; u[theirs + "n"] = n;
      await update(ref(db), u);
      return true;
    } catch (err) {}
  }
  return false;
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
  const ok = await dmWrite(conv, other, key, text, takeReply({ t: "d", id: conv }));
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

// ---------- Message options (reply / copy / delete) and links ----------
// Everything here works for rooms (scope.t = "r") and private chats (scope.t = "d").
const hiddenSets = {};                       // "r<room>" / "d<conv>" -> Set of keys I deleted "for me"
function isHidden(scope, key) { const s = hiddenSets[scope.t + scope.id]; return !!(s && key && s.has(key)); }
function boxOf(scope) { return $(scope.t === "r" ? "msgs" : scope.t === "d" ? "dmMsgs" : "gMsgs"); }
async function loadHidden(scope) {
  const sk = scope.t + scope.id;
  try {
    const v = (await get(ref(db, "hidden/" + uid + "/" + scope.id))).val();
    const set0 = hiddenSets[sk] || (hiddenSets[sk] = new Set());
    if (v && typeof v === "object") Object.keys(v).forEach((k) => set0.add(k));
    set0.forEach((k) => removeMsgEl(scope, k, true));       // anything already drawn that I had deleted
  } catch (e) {}
}
function removeMsgEl(scope, key, keepCache) {
  const el = boxOf(scope).querySelector('.msg[data-key="' + key + '"]');
  if (el) el.remove();
  if (scope.t === "r") {
    const c = msgCache[uid + "/" + scope.id];
    if (c) c.items = c.items.filter((x) => x.key !== key);
    msgQueue = msgQueue.filter((x) => x[1] !== key);
  }
  mediaCache.delete(mcKey(scope, key));
}

// ---- links ----
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
function ytId(u) {
  const h = u.hostname.replace(/^(www|m|music)\./, "");
  let id = "";
  if (h === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (h === "youtube.com" || h === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else { const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?]+)/); if (m) id = m[1]; }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}
// null = not a safe web link (it stays plain text)
function parseLink(raw) {
  let s = raw;
  for (;;) {
    const c = s.slice(-1);
    if (!c) return null;
    if (/[.,;:!?'"\]}>*]/.test(c)) { s = s.slice(0, -1); continue; }
    if (c === ")" && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) { s = s.slice(0, -1); continue; }
    break;
  }
  const full = /^www\./i.test(s) ? "https://" + s : s;
  if (full.length > 400) return null;
  let u; try { u = new URL(full); } catch (e) { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname;
  if (!host || !host.includes(".") || /\.(local|internal|lan)$/i.test(host)) return null;
  let warn = "";
  if (u.username || u.password) warn = "This link contains a hidden login part, which scammers use to disguise the real website.";
  else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) warn = "This link goes to a number address instead of a normal website name.";
  else if (host.split(".").some((l) => l.startsWith("xn--"))) warn = "This website name uses look-alike characters. Make sure you trust it.";
  else if (u.port && u.port !== "80" && u.port !== "443") warn = "This link uses an unusual port. Make sure you trust it.";
  return { url: u.href, shown: s, host: host.replace(/^www\./, ""), warn, yt: ytId(u) };
}
function linkify(el, text) {
  let last = 0, yt = "", m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    const info = parseLink(m[0]);
    if (!info) continue;
    const end = m.index + info.shown.length;
    if (m.index > last) el.append(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement("a");
    a.className = "lnk"; a.href = info.url; a.rel = "noopener noreferrer nofollow"; a.textContent = info.shown;
    a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() < pressUntil) return; info.yt ? openYt(info.yt) : askLink(info); };
    el.append(a);
    if (info.yt && !yt) yt = info.yt;
    last = end; URL_RE.lastIndex = end;
  }
  if (last < text.length) el.append(document.createTextNode(text.slice(last)));
  return yt;
}
function textBody(text) {
  const d = document.createElement("div");
  if (!/https?:\/\/|www\./i.test(text)) { d.textContent = text; return d; }
  const yt = linkify(d, text);
  if (yt) {
    const c = document.createElement("div"); c.className = "ytChip";
    const i = document.createElement("i"); i.textContent = "▶";
    const t = document.createElement("span"); t.textContent = "Watch YouTube video";
    c.append(i, t); c.onclick = (e) => { e.stopPropagation(); if (Date.now() >= pressUntil) openYt(yt); };
    d.append(c);
  }
  return d;
}
function openExternal(url) {
  const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
  const fallback = () => { window.open(url, "_blank", "noopener,noreferrer"); };
  if (B && B.open) { B.open({ url, toolbarColor: "#000000" }).catch(fallback); } else fallback();
}
let linkPending = null;
function askLink(info) {
  linkPending = info;
  $("lkHost").textContent = info.host;
  $("lkUrl").textContent = info.url.length > 160 ? info.url.slice(0, 157) + "…" : info.url;
  $("lkWarn").hidden = !info.warn; $("lkWarn").textContent = "⚠️ " + info.warn;
  $("linkSheet").classList.add("open");
}
$("lkOpen").onclick = () => { const i = linkPending; $("linkSheet").classList.remove("open"); linkPending = null; if (i) openExternal(i.url); };
$("lkNo").onclick = () => { $("linkSheet").classList.remove("open"); linkPending = null; };
let ytCur = "";
function openYt(id) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  stopAllAudio(); ytCur = id;
  $("ytFrame").src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&playsinline=1&rel=0";
  $("ytView").classList.add("open");
  history.pushState({ img: true }, "");
}
$("ytX").onclick = () => closeMediaOverlays();
$("ytOpen").onclick = () => { if (ytCur) openExternal("https://www.youtube.com/watch?v=" + ytCur); };
$("linkSheet").onclick = (e) => { if (e.target.id === "linkSheet") { $("linkSheet").classList.remove("open"); linkPending = null; } };

// ---- replies ----
let replyTo = null;       // { sk, key, rn, rf, rt }
function barFor(scope) { return $(scope.t === "r" ? "replyBar" : scope.t === "d" ? "dmReplyBar" : "gReplyBar"); }
function setReply(scope, info) {
  clearReply();
  replyTo = Object.assign({ sk: scope.t + scope.id }, info);
  const bar = barFor(scope);
  bar.querySelector("b").textContent = info.rn === myName || info.rf === uid ? "You" : (info.rn || "Reply");
  bar.querySelector("span").textContent = info.rt;
  bar.hidden = false;
  $(scope.t === "r" ? "msgInput" : scope.t === "d" ? "dmInput" : "gInput").focus();
}
function clearReply() { replyTo = null; $("replyBar").hidden = true; $("dmReplyBar").hidden = true; $("gReplyBar").hidden = true; }
document.querySelectorAll(".replyBar .rbx").forEach((b) => { b.onclick = clearReply; });
// the extra fields a new message carries when I am replying (and the reply is cleared)
function takeReply(scope) {
  const r = replyTo;
  if (!r || r.sk !== scope.t + scope.id) { clearReply(); return {}; }
  clearReply();
  return scope.t === "d" ? { rf: r.rf, rk: r.rk, rt: r.rt } : { rn: r.rn, rk: r.rk, rt: r.rt };
}
function quoteEl(m, scope) {
  const q = document.createElement("div"); q.className = "quote";
  const n = document.createElement("div"); n.className = "qn";
  n.textContent = scope.t === "d" ? (m.rf === uid ? "You" : (dmName || "User")) : (m.rn === myName ? "You" : (m.rn || "?"));
  const t = document.createElement("div"); t.className = "qt"; t.textContent = m.rt;
  q.append(n, t);
  q.onclick = (e) => {
    e.stopPropagation();
    if (Date.now() < pressUntil) return;
    const el = boxOf(scope).querySelector('.msg[data-key="' + String(m.rk).replace(/"/g, "") + '"]');
    if (!el) { toast("The original message isn't on screen."); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("hl"); setTimeout(() => el.classList.remove("hl"), 1300);
  };
  return q;
}

// ---- long-press menu ----
let pressUntil = 0, menuMsg = null;
function closeMsgSheets() {
  let any = false;
  for (const id of ["msgMenu", "delSheet", "linkSheet", "gNewSheet", "gActSheet"]) { if ($(id).classList.contains("open")) { $(id).classList.remove("open"); any = true; } }
  return any;
}
function initPress(box) {
  let tmr = 0, sx = 0, sy = 0;
  const stop = () => { clearTimeout(tmr); tmr = 0; };
  const find = (e) => { const el = e.target.closest && e.target.closest(".msg"); return el && el._m ? el : null; };
  box.addEventListener("touchstart", (e) => {
    const el = find(e); if (!el || e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    stop(); tmr = setTimeout(() => { tmr = 0; pressUntil = Date.now() + 700; if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) {} } openMsgMenu(el); }, 450);
  }, { passive: true });
  box.addEventListener("touchmove", (e) => { if (tmr && (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10)) stop(); }, { passive: true });
  ["touchend", "touchcancel"].forEach((n) => box.addEventListener(n, stop, { passive: true }));
  box.addEventListener("contextmenu", (e) => { const el = find(e); if (el) { e.preventDefault(); pressUntil = Date.now() + 700; openMsgMenu(el); } });
  box.addEventListener("click", (e) => { if (Date.now() < pressUntil) { e.preventDefault(); e.stopPropagation(); } }, true);
}
initPress($("msgs")); initPress($("dmMsgs")); initPress($("gMsgs"));
function canDeleteAll(m) {
  if (m.mine) return true;
  if (m.scope.t !== "g") return false;
  const me = myRole();
  if (me === "a") return true;
  if (me === "m") { const a = roleOf(m.uid); return a !== "a" && a !== "m"; }
  return false;
}
function openMsgMenu(el) {
  const m = el._m;
  if (!m || $("msgMenu").classList.contains("open") || (m.scope.t === "d" && blocksCache[dmOther])) return;
  menuMsg = m;
  $("mmPrev").textContent = m.text;
  $("mmCopy").hidden = !!m.k;
  $("msgMenu").classList.add("open");
}
$("msgMenu").onclick = (e) => { if (e.target.id === "msgMenu") $("msgMenu").classList.remove("open"); };
$("delSheet").onclick = (e) => { if (e.target.id === "delSheet") $("delSheet").classList.remove("open"); };
$("mmReply").onclick = () => {
  const m = menuMsg; $("msgMenu").classList.remove("open"); if (!m || !m.key) return;
  setReply(m.scope, { key: m.key, rk: m.key, rn: m.name || "", rf: m.uid, rt: m.text.slice(0, 80) });
};
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast("Copied"); return; } catch (e) {}
  try {
    const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0;top:0";
    document.body.append(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove();
    toast(ok ? "Copied" : "Couldn't copy");
  } catch (e) { toast("Couldn't copy"); }
}
$("mmCopy").onclick = () => { const m = menuMsg; $("msgMenu").classList.remove("open"); if (m && !m.k) copyText(m.text); };
$("mmDel").onclick = () => {
  const m = menuMsg; $("msgMenu").classList.remove("open"); if (!m || !m.key) return;
  if (pendingKeys.has(m.key)) { toast("Wait until it is sent."); return; }
  $("delAll").hidden = !canDeleteAll(m);
  $("delAll").textContent = m.mine ? "Delete for everyone" : "Remove for everyone (moderator)";
  $("delSheet").classList.add("open");
};
$("delNo").onclick = () => $("delSheet").classList.remove("open");
$("delMe").onclick = () => {
  const m = menuMsg; $("delSheet").classList.remove("open"); if (!m) return;
  (hiddenSets[m.scope.t + m.scope.id] || (hiddenSets[m.scope.t + m.scope.id] = new Set())).add(m.key);
  removeMsgEl(m.scope, m.key);
  set(ref(db, "hidden/" + uid + "/" + m.scope.id + "/" + m.key), true).catch(() => toast("Couldn't save that. It may come back later."));
};
function msgNodePath(scope, key) {
  return scope.t === "r" ? scope.id + "/messages/" + key : scope.t === "d" ? "dms/" + scope.id + "/messages/" + key : "groups/" + scope.id + "/messages/" + key;
}
$("delAll").onclick = async () => {
  const m = menuMsg; $("delSheet").classList.remove("open"); if (!m || !canDeleteAll(m)) return;
  const scope = m.scope, box = boxOf(scope);
  const isLast = scope.t === "d" && box.lastElementChild && box.lastElementChild.dataset.key === m.key;
  const u = {}; u[msgNodePath(scope, m.key)] = null;
  if (m.k) u[mediaPath(scope, m.key)] = null;
  let ok = false;
  try { await update(ref(db), u); ok = true; } catch (e) {}
  if (!ok && m.k) {                       // the picture/voice may already be gone: remove just the message
    try { const u2 = {}; u2[msgNodePath(scope, m.key)] = null; await update(ref(db), u2); ok = true; } catch (e) {}
  }
  if (!ok) { toast("Couldn't delete. Check your connection."); return; }
  removeMsgEl(scope, m.key);
  if (isLast && dmOther) {                // keep the chat list from still showing the deleted words
    const v = {}; v["inbox/" + uid + "/" + scope.id + "/last"] = "🚫 Message deleted"; v["inbox/" + dmOther + "/" + scope.id + "/last"] = "🚫 Message deleted";
    update(ref(db), v).catch(() => {});
  }
};
// decorate a freshly built bubble
function decorateMsg(d, m, key, scope, mine, who, name) {
  d._m = { key, scope, mine, uid: who, name, text: m.text, k: m.k };
}

// ---------- Photos and voice messages ----------
// The chat message itself stays tiny ("📷 Photo" + size info). The picture / sound is saved
// separately (roomMedia/... or dmMedia/...) and is only downloaded when it is on screen
// (photos) or when someone taps play (voice). Media is removed after 7 days.
const MEDIA_LIFE = 7 * 86400000, VOICE_MAX = 45;
let ignorePops = 0;
const mediaCache = new Map();               // "r<room>/<key>" -> data URL (newest 24 only)
function mcKey(scope, key) { return scope.t + scope.id + "/" + key; }
function cachePut(k, v) {
  mediaCache.delete(k); mediaCache.set(k, v);
  while (mediaCache.size > 24) mediaCache.delete(mediaCache.keys().next().value);
}
function mediaPath(scope, key) { return (scope.t === "r" ? "roomMedia/" : scope.t === "d" ? "dmMedia/" : "groupMedia/") + scope.id + "/" + key; }
// null = not available, "gone" = expired, otherwise the data URL
async function fetchMedia(scope, key) {
  const ck = mcKey(scope, key);
  if (mediaCache.has(ck)) return mediaCache.get(ck);
  const v = (await get(ref(db, mediaPath(scope, key)))).val();
  if (!v || typeof v.d !== "string") return null;
  if (typeof v.ts === "number" && Date.now() > v.ts + MEDIA_LIFE) {
    remove(ref(db, mediaPath(scope, key))).catch(() => {});   // old media tidies itself up
    return "gone";
  }
  cachePut(ck, v.d);
  return v.d;
}
const mediaIO = "IntersectionObserver" in window
  ? new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { mediaIO.unobserve(e.target); if (e.target._load) e.target._load(); }
    }), { rootMargin: "120px" })
  : null;
function whenVisible(el, fn) { el._load = fn; if (mediaIO) mediaIO.observe(el); else fn(); }
function fmtDur(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

function mediaBody(m, key, scope, bubble) {
  if (m.k === "i") return imageBody(m, key, scope, bubble);
  if (m.k === "a") return audioBody(Number(m.d) || 0, () => fetchMedia(scope, key));
  const d = document.createElement("div"); d.textContent = m.text; return d;
}
function imageBody(m, key, scope, bubble) {
  if (bubble) bubble.classList.add("media");
  const box = document.createElement("div");
  box.className = "mImg";
  const w = Math.min(4000, Math.max(1, Number(m.w) || 4)), h = Math.min(4000, Math.max(1, Number(m.h) || 3));
  box.style.aspectRatio = w + " / " + h;
  const note = document.createElement("span"); note.className = "mNote"; note.textContent = "📷 Photo";
  box.append(note);
  const load = async () => {
    let d = null;
    try { d = await fetchMedia(scope, key); } catch (e) {}
    if (d === "gone") { note.textContent = "📷 Photo expired"; box.onclick = null; box.style.cursor = "default"; return; }
    if (!d) { note.textContent = "📷 Couldn't load. Tap to retry"; box.onclick = () => { note.textContent = "📷 Loading…"; load(); }; return; }
    const im = document.createElement("img"); im.alt = "Photo"; im.src = d; im.decoding = "async";
    note.remove(); box.append(im);
    box.onclick = () => openImgView(d);
  };
  whenVisible(box, load);
  return box;
}
let playingAudio = null;
function stopAllAudio() { if (playingAudio) { playingAudio.pause(); playingAudio = null; } }
function audioBody(dur, getSrc) {
  const el = document.createElement("div"); el.className = "mAud";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "mPlay"; btn.textContent = "▶"; btn.setAttribute("aria-label", "Play voice message");
  const bar = document.createElement("div"); bar.className = "mBar"; const fill = document.createElement("i"); bar.append(fill);
  const time = document.createElement("span"); time.className = "mTime"; time.textContent = fmtDur(dur);
  el.append(btn, bar, time);
  let au = null, loading = false;
  btn.onclick = async () => {
    if (au && !au.paused) { au.pause(); return; }
    if (!au) {
      if (loading) return;
      loading = true; btn.textContent = "…";
      let src = null;
      try { src = await getSrc(); } catch (e) {}
      loading = false;
      if (!src || src === "gone") { btn.textContent = "▶"; time.textContent = src === "gone" ? "Expired" : "Unavailable"; return; }
      au = new Audio(src); au.preload = "auto";
      au.onplay = () => { if (playingAudio && playingAudio !== au) playingAudio.pause(); playingAudio = au; btn.textContent = "⏸"; };
      au.onpause = () => { btn.textContent = "▶"; if (playingAudio === au) playingAudio = null; };
      au.onended = () => { btn.textContent = "▶"; fill.style.width = "0"; time.textContent = fmtDur(dur); if (playingAudio === au) playingAudio = null; };
      au.ontimeupdate = () => {
        const total = dur || (isFinite(au.duration) ? au.duration : 0);
        if (total) fill.style.width = Math.min(100, au.currentTime / total * 100) + "%";
        time.textContent = fmtDur(au.currentTime);
      };
    }
    try { await au.play(); } catch (e) { btn.textContent = "▶"; toast("Can't play this voice message on this device."); }
  };
  return el;
}

// ---- Full-screen photo + preview before sending ----
function openImgView(src) {
  $("imgViewImg").src = src; $("imgView").classList.add("open");
  history.pushState({ img: true }, "");
}
function closeMediaOverlays(fromPop) {
  const vw = $("imgView"), pv = $("imgPrev"), yv = $("ytView");
  const el = yv.classList.contains("open") ? yv : vw.classList.contains("open") ? vw : pv.classList.contains("open") ? pv : null;
  if (!el) return false;
  el.classList.remove("open");
  if (el === vw) $("imgViewImg").removeAttribute("src");
  else if (el === yv) $("ytFrame").src = "about:blank";
  else { pendingPhoto = null; $("imgPrevImg").removeAttribute("src"); }
  if (!fromPop && !CapApp) { ignorePops++; history.back(); }
  return true;
}
$("imgViewX").onclick = () => closeMediaOverlays();
$("imgViewPv").onclick = (e) => { if (e.target.id !== "imgViewImg") closeMediaOverlays(); };
$("imgPrevNo").onclick = () => closeMediaOverlays();

// Photos: shrink to at most 1080 px, JPEG, usually 80-140 KB.
function shrinkChatPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      try {
        let scale = Math.min(1, 1080 / Math.max(im.naturalWidth, im.naturalHeight)), q = 0.76, out = "", w = 1, h = 1;
        for (let i = 0; i < 7; i++) {
          const cv = document.createElement("canvas");
          w = cv.width = Math.max(1, Math.round(im.naturalWidth * scale)); h = cv.height = Math.max(1, Math.round(im.naturalHeight * scale));
          const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
          out = cv.toDataURL("image/jpeg", q);
          if (out.length < 150000) break;
          q = Math.max(0.45, q - 0.07); scale *= 0.85;
        }
        URL.revokeObjectURL(url);
        out.startsWith("data:image/jpeg;base64,") && out.length < 200000 ? resolve({ data: out, w, h }) : reject(new Error("big"));
      } catch (e) { reject(e); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    im.src = url;
  });
}
let pendingPhoto = null, photoScope = null;
function chatScope() {
  if (grpOpen) {
    if (isMuted(grpMembers[uid])) { toast("You are muted in this group."); return null; }
    return { t: "g", id: grpId };
  }
  if (dmOpen) {
    if (blocksCache[dmOther]) { toast("Unblock this user to send messages."); return null; }
    return { t: "d", id: dmConvId, other: dmOther };
  }
  return inRoom ? { t: "r", id: ROOM } : null;
}
["imgBtn", "dmImgBtn", "gImgBtn"].forEach((id) => { $(id).onclick = () => {
  const sc = chatScope(); if (!sc) return;
  photoScope = sc; $("imgFile").value = ""; $("imgFile").click();
}; });
$("imgFile").onchange = async () => {
  const f = $("imgFile").files && $("imgFile").files[0];
  $("imgFile").value = "";
  if (!f || !photoScope) return;
  if (!/^image\//.test(f.type)) { toast("Please pick a photo."); return; }
  toast("Preparing photo…");
  try {
    const r = await shrinkChatPhoto(f);
    pendingPhoto = Object.assign({ scope: photoScope }, r);
    $("imgPrevImg").src = r.data; $("imgPrev").classList.add("open");
    history.pushState({ img: true }, "");
  } catch (e) { toast("Couldn't use that photo. Try another one."); }
};
$("imgPrevYes").onclick = () => {
  const p = pendingPhoto; if (!p) return;
  closeMediaOverlays();
  sendMedia(p.scope, "i", p.data, { w: p.w, h: p.h });
};

// ---- Sending (message + media are saved together, or not at all) ----
async function sendMedia(scope, kind, data, meta) {
  const label = kind === "i" ? "📷 Photo" : "🎤 Voice message";
  const key = push(ref(db, msgNodePath(scope, "x").replace(/\/x$/, ""))).key;
  cachePut(mcKey(scope, key), data);
  pendingKeys.add(key);
  playSendSound();
  const extra = Object.assign(kind === "i" ? { k: "i", w: meta.w, h: meta.h } : { k: "a", d: meta.d }, takeReply(scope));
  const more = {};
  more[mediaPath(scope, key)] = { uid, d: data, ts: serverTimestamp() };
  more["mediaLast/" + uid + "/ts"] = serverTimestamp();
  let ok = false;
  if (scope.t === "r" || scope.t === "g") {
    const u = Object.assign({}, more);
    u[msgNodePath(scope, key)] = Object.assign({ uid, name: myName, text: label, ts: serverTimestamp() }, extra);
    if (scope.t === "g") u["groups/" + scope.id + "/last"] = { t: label, ts: serverTimestamp(), n: myName };
    try { await update(ref(db), u); ok = true; } catch (e) {}
  } else {
    ok = await dmWrite(scope.id, scope.other, key, label, extra, more);
  }
  pendingKeys.delete(key);
  const sel = "#" + boxOf(scope).id + ' .msg[data-key="' + key + '"]';
  if (ok) { const t = document.querySelector(sel + " .tick"); if (t) t.textContent = " ✓"; }
  else {
    msgQueue = msgQueue.filter((x) => x[1] !== key);
    const el = document.querySelector(sel); if (el) el.remove();
    if (scope.t === "d") delete sentLocal[scope.id];
    toast("Not sent. Wait a few seconds between photos/voice messages, and check your connection.");
  }
}

// ---- Recording ----
let rec = null;
function setRecUI(r, html) { r.bar.innerHTML = ""; r.bar.append(html); }
function micBtns() { return [["micBtn", "sendForm"], ["dmMicBtn", "dmForm"], ["gMicBtn", "gForm"]]; }
micBtns().forEach(([bid, fid]) => { $(bid).onclick = () => { const sc = chatScope(); if (sc) startRec($(fid), sc); }; });
function mkBtn(txt, cls, fn, label) {
  const b = document.createElement("button"); b.type = "button"; b.className = "mBtn " + (cls || ""); b.textContent = txt; b.onclick = fn;
  if (label) b.setAttribute("aria-label", label); return b;
}
async function startRec(form, scope) {
  if (rec) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder === "undefined") { toast("Voice messages aren't supported on this device."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { toast("Allow the microphone to record voice messages."); return; }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  let mr;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); toast("Voice messages aren't supported on this device."); return; }
  stopAllAudio();
  const bar = document.createElement("div"); bar.className = "recBar"; form.append(bar); form.classList.add("rec");
  const r = rec = { form, scope, mr, stream, bar, chunks: [], t0: Date.now(), timer: 0, state: "rec", mime: (mr.mimeType || mime || "audio/webm"), data: null, dur: 0 };
  mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
  mr.onstop = () => finishRec(r);
  const wrap = document.createElement("div"); wrap.className = "recBar"; wrap.style.cssText = "flex:1;display:flex;align-items:center;gap:10px";
  const info = document.createElement("div"); info.className = "rbInfo";
  const dot = document.createElement("span"); dot.className = "dot";
  const tm = document.createElement("span"); tm.textContent = "0:00";
  const hint = document.createElement("span"); hint.style.cssText = "opacity:.6;font-weight:600;font-size:13px"; hint.textContent = "Recording… max " + VOICE_MAX + " s";
  info.append(dot, tm, hint);
  wrap.append(mkBtn("✕", "", () => cancelRec(), "Cancel recording"), info, mkBtn("■", "mic", () => stopRec(), "Stop recording"));
  setRecUI(r, wrap);
  mr.start();
  r.timer = setInterval(() => {
    const s = (Date.now() - r.t0) / 1000;
    tm.textContent = fmtDur(s);
    if (s >= VOICE_MAX) stopRec();
  }, 250);
}
function stopRec() {
  const r = rec; if (!r || r.state !== "rec") return;
  r.state = "stopping"; clearInterval(r.timer);
  r.dur = (Date.now() - r.t0) / 1000;
  try { if (r.mr.state !== "inactive") r.mr.stop(); } catch (e) {}
  r.stream.getTracks().forEach((t) => t.stop());
}
function cancelRec() {
  const r = rec; if (!r) return;
  r.cancelled = true; rec = null; clearInterval(r.timer);
  try { if (r.mr.state !== "inactive") r.mr.stop(); } catch (e) {}
  r.stream.getTracks().forEach((t) => t.stop());
  r.bar.remove(); r.form.classList.remove("rec");
}
function finishRec(r) {
  if (r.cancelled || rec !== r) return;
  if (r.dur < 1) { toast("Too short. Hold on a little longer."); cancelRec(); return; }
  const base = String(r.mime).split(";")[0].toLowerCase();
  if (!/^audio\/(webm|ogg|mp4|aac)$/.test(base)) { toast("Voice messages aren't supported on this device."); cancelRec(); return; }
  const fr = new FileReader();
  fr.onload = () => {
    if (rec !== r) return;
    const b64 = String(fr.result).split("base64,")[1] || "";
    r.data = "data:" + base + ";base64," + b64;
    if (!b64 || r.data.length >= 230000) { toast("That recording is too big. Try a shorter one."); cancelRec(); return; }
    r.state = "ready";
    const wrap = document.createElement("div"); wrap.className = "recBar";
    const pl = audioBody(Math.ceil(r.dur), async () => r.data);
    const send = mkBtn("➤", "mic", async () => {
      const sc = r.scope;
      if (sc.t === "d" && blocksCache[sc.other]) { toast("Unblock this user to send messages."); return; }
      const d = r.data, dur = Math.ceil(r.dur);
      cancelRec();
      sendMedia(sc, "a", d, { d: Math.max(1, Math.min(61, dur)) });
    }, "Send voice message");
    wrap.append(mkBtn("🗑", "", () => cancelRec(), "Delete recording"), pl, send);
    setRecUI(r, wrap);
  };
  fr.onerror = () => { toast("Couldn't read the recording."); cancelRec(); };
  fr.readAsDataURL(new Blob(r.chunks, { type: base }));
}
// If the app goes to the background mid-recording, stop and keep what was recorded.
document.addEventListener("visibilitychange", () => { if (document.hidden && rec && rec.state === "rec") stopRec(); });

// ---------- Groups ----------
// groups/<id>/{meta, members/<uid>{r,j,mu}, messages, last}. r: "a" admin (the creator), "m" moderator, "u" member.
// mu = "muted until" (a time). All permissions are enforced by the database rules, not just by these buttons.
const GROUP_MAX = 50, MUTE_FOR_EVER = 4102444800000;
let grpOpen = false, grpInfoOpen = false, grpId = null, grpMeta = null, grpMembers = {}, grpReady = false, grpOffs = [], grpMuteTimer = 0, grpLeaving = false;
let grpList = {}, grpCache = {}, grpListOff = null;
const myRole = () => (grpMembers[uid] && grpMembers[uid].r) || "";
const roleOf = (u) => (grpMembers[u] && grpMembers[u].r) || "";
const isMuted = (m) => !!(m && Number(m.mu) > Date.now());
function startGroupList() {
  if (grpListOff || !uid) return;
  grpListOff = onValue(ref(db, "userGroups/" + uid), (snap) => { grpList = snap.val() || {}; refreshGroups(true); }, () => {});
}
function stopGroupList() {
  if (grpListOff) { grpListOff(); grpListOff = null; }
  grpList = {}; grpCache = {}; $("grpList").innerHTML = ""; $("grpLabel").hidden = true; $("dmLabel").hidden = true;
}
async function refreshGroups(force) {
  const ids = Object.keys(grpList), now = Date.now();
  await Promise.all(ids.map(async (gid) => {
    const c = grpCache[gid];
    if (!force && c && now - c.t < 30000) return;
    try {
      const [m, l] = await Promise.all([get(ref(db, "groups/" + gid + "/meta")), get(ref(db, "groups/" + gid + "/last"))]);
      grpCache[gid] = { meta: m.val(), last: l.val(), t: Date.now(), gone: !m.exists() };
    } catch (e) {
      if (e && e.code === "PERMISSION_DENIED") grpCache[gid] = { gone: true, t: Date.now() };   // I am no longer in it
      else if (!c) grpCache[gid] = { meta: null, last: null, t: Date.now(), err: true };
    }
  }));
  ids.forEach((gid) => {
    const c = grpCache[gid];
    if (c && c.gone) { remove(ref(db, "userGroups/" + uid + "/" + gid)).catch(() => {}); delete grpCache[gid]; delete grpList[gid]; }
  });
  renderGroups();
}
function updateDmLabel(dmCount) {
  const hasG = Object.keys(grpList).length > 0;
  $("dmLabel").hidden = !(hasG && dmCount > 0);
  $("grpLabel").hidden = !hasG;
}
function renderGroups() {
  const box = $("grpList");
  const rows = Object.keys(grpList).map((gid) => [gid, grpCache[gid]]).filter(([, c]) => c && c.meta)
    .sort((a, b) => ((b[1].last && b[1].last.ts) || b[1].meta.ts || 0) - ((a[1].last && a[1].last.ts) || a[1].meta.ts || 0));
  box.innerHTML = "";
  rows.forEach(([gid, c]) => {
    const b = document.createElement("button"); b.className = "dmItem"; b.type = "button";
    const av = document.createElement("div"); av.className = "av"; drawAv(av, c.meta.ph ? { ph: c.meta.ph } : null, c.meta.name);
    const mid = document.createElement("div"); mid.className = "mid";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = c.meta.name;
    const pv = document.createElement("div"); pv.className = "pv";
    pv.textContent = c.last ? (c.last.n === myName ? "You" : c.last.n) + ": " + c.last.t : "No messages yet";
    mid.append(nm, pv);
    const rt = document.createElement("div"); rt.className = "rt2";
    const tm = document.createElement("div"); tm.className = "tmx"; tm.textContent = c.last ? fmtListTime(c.last.ts) : ""; rt.append(tm);
    b.append(av, mid, rt);
    b.onclick = () => openGroup(gid);
    box.append(b);
  });
  updateDmLabel(Object.values(inboxCache).filter(dmVisible).length);
  $("dmEmpty").style.display = rows.length || Object.values(inboxCache).some(dmVisible) ? "none" : "";
}

// ---- create ----
let gNewPh = null, gFileMode = "new";
function drawNewPic() { drawAv($("gNewPic"), gNewPh ? { ph: gNewPh } : null, "+"); $("gNewPicNo").hidden = !gNewPh; }
$("newGroupBtn").onclick = () => {
  gNewPh = null; $("gNewName").value = ""; drawNewPic();
  $("gNewSheet").classList.add("open"); setTimeout(() => $("gNewName").focus(), 150);
};
$("gNewNo").onclick = () => $("gNewSheet").classList.remove("open");
$("gNewSheet").onclick = (e) => { if (e.target.id === "gNewSheet") $("gNewSheet").classList.remove("open"); };
$("gNewPicBtn").onclick = () => { gFileMode = "new"; $("gFile").click(); };
$("gNewPicNo").onclick = () => { gNewPh = null; drawNewPic(); };
$("gFile").onchange = async () => {
  const f = $("gFile").files && $("gFile").files[0]; $("gFile").value = "";
  if (!f) return;
  if (!/^image\//.test(f.type)) { toast("Please pick a photo."); return; }
  let ph; try { ph = await shrinkPhoto(f); } catch (e) { toast("Couldn't use that photo."); return; }
  if (gFileMode === "new") { gNewPh = ph; drawNewPic(); return; }
  if (!grpId || myRole() !== "a") return;
  try { await set(ref(db, "groups/" + grpId + "/meta/ph"), ph); toast("Group picture updated."); } catch (e) { toast("Couldn't change the picture."); }
};
$("gNewOk").onclick = async () => {
  const name = $("gNewName").value.trim().replace(/\s+/g, " ");
  if (!name) { toast("Give the group a name."); return; }
  $("gNewOk").disabled = true;
  const gid = push(ref(db, "groups")).key, now = serverTimestamp();
  const meta = { name: name.slice(0, 30), by: uid, ts: now }; if (gNewPh) meta.ph = gNewPh;
  const u = {};
  u["groups/" + gid + "/meta"] = meta;
  u["groups/" + gid + "/members/" + uid] = { r: "a", j: now };
  u["userGroups/" + uid + "/" + gid] = true;
  u["groupMake/" + uid + "/ts"] = now;
  try {
    await update(ref(db), u);
    $("gNewSheet").classList.remove("open");
    grpCache[gid] = { meta: { name: meta.name, ph: gNewPh || undefined, by: uid, ts: Date.now() }, last: null, t: Date.now() };
    grpList[gid] = true;
    openGroup(gid);
    toast("Group created. Tap the group name to add people.");
  } catch (e) { toast("Couldn't create the group. Wait 20 seconds between groups and check your connection."); }
  $("gNewOk").disabled = false;
};

// ---- open / close ----
function paintGroupHead() {
  $("gTitle").textContent = grpMeta ? grpMeta.name : "…";
  drawAv($("gAv"), grpMeta && grpMeta.ph ? { ph: grpMeta.ph } : null, grpMeta ? grpMeta.name : "G");
}
function openGroup(gid) {
  if (!gid || grpOpen) return;
  grpOpen = true; grpId = gid; grpLeaving = false; grpReady = false; grpMembers = {};
  grpMeta = (grpCache[gid] && grpCache[gid].meta) || null;
  history.pushState({ grp: true }, "");
  $("gMsgs").innerHTML = ""; stick.set($("gMsgs"), true);
  $("gSub").textContent = " ";
  paintGroupHead(); show("grp"); updateGroupComposer();
  const sc = { t: "g", id: gid };
  const gone = (msg) => { if (grpId !== gid) return; if (msg && !grpLeaving) toast(msg); remove(ref(db, "userGroups/" + uid + "/" + gid)).catch(() => {}); delete grpList[gid]; delete grpCache[gid]; leaveGroup(); };
  grpOffs.push(onValue(ref(db, "groups/" + gid + "/meta"), (s) => {
    if (grpId !== gid) return;
    if (!s.exists()) { gone("You were removed from this group, or it was deleted."); return; }
    grpMeta = s.val(); grpCache[gid] = Object.assign(grpCache[gid] || { t: Date.now() }, { meta: grpMeta });
    paintGroupHead(); if (grpInfoOpen) renderGroupInfo();
  }, () => gone("You were removed from this group, or it was deleted.")));
  grpOffs.push(onValue(ref(db, "groups/" + gid + "/members"), (s) => {
    if (grpId !== gid) return;
    const v = s.val() || {}, had = grpReady;
    grpMembers = v; grpReady = true;
    if (!v[uid]) { if (had) gone("You were removed from this group, or it was deleted."); return; }
    $("gSub").textContent = Object.keys(v).length + " members";
    updateGroupComposer(); if (grpInfoOpen) renderGroupInfo();
  }, () => {}));
  const q = query(ref(db, "groups/" + gid + "/messages"), orderByChild("ts"), limitToLast(100));
  grpOffs.push(onChildAdded(q, (snap) => { if (grpId === gid) addGroupMessage(snap.val(), snap.key); }, () => {}));
  grpOffs.push(onChildRemoved(q, (snap) => { if (grpId === gid) removeMsgEl(sc, snap.key); }));
  loadHidden(sc);
}
function leaveGroup() {
  if (!grpOpen) return;
  grpOpen = false; grpInfoOpen = false;
  cancelRec(); stopAllAudio(); clearReply(); closeMsgSheets(); clearTimeout(grpMuteTimer);
  grpOffs.forEach((f) => { try { f(); } catch (e) {} }); grpOffs = [];
  grpId = null; grpMeta = null; grpMembers = {};
  show("lobby"); setTab("chats"); refreshGroups(true);
}
$("gBack").onclick = () => { if (CapApp) leaveGroup(); else history.back(); };
$("giBack").onclick = () => { if (CapApp) closeGroupInfo(); else history.back(); };
function updateGroupComposer() {
  const me = grpMembers[uid], muted = isMuted(me);
  $("gForm").style.display = muted ? "none" : "";
  $("gMutedBar").classList.toggle("show", muted);
  clearTimeout(grpMuteTimer);
  if (muted) {
    cancelRec();
    $("gMutedBar").textContent = me.mu >= MUTE_FOR_EVER ? "🔇 A moderator muted you in this group." : "🔇 You are muted until " + fmtTime(me.mu) + ".";
    if (me.mu < MUTE_FOR_EVER) grpMuteTimer = setTimeout(updateGroupComposer, Math.min(me.mu - Date.now() + 500, 2000000000));
  }
}
function addGroupMessage(m, key) {
  if (!m || typeof m.text !== "string" || !grpId) return;
  const sc = { t: "g", id: grpId }, box = $("gMsgs");
  if (key && box.querySelector('[data-key="' + key + '"]')) return;
  if (isHidden(sc, key)) return;
  const nearBottom = stick.get(box) || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const el = buildMessage(m, key, sc);
  box.append(el);
  while (box.childElementCount > 300) box.firstElementChild.remove();
  if (nearBottom || m.uid === uid) box.scrollTop = box.scrollHeight;
}
$("gForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("gInput").value.trim();
  if (!text || !grpId) return;
  if (isMuted(grpMembers[uid])) { toast("You are muted in this group."); return; }
  const gid = grpId;
  $("gInput").value = ""; autosize($("gInput"));
  playSendSound();
  const key = push(ref(db, "groups/" + gid + "/messages")).key;
  const rx = takeReply({ t: "g", id: gid });
  pendingKeys.add(key);
  const u = {};
  u["groups/" + gid + "/messages/" + key] = Object.assign({ uid, name: myName, text, ts: serverTimestamp() }, rx);
  u["groups/" + gid + "/last"] = { t: text.slice(0, 80), ts: serverTimestamp(), n: myName };
  try {
    await update(ref(db), u);
    pendingKeys.delete(key);
    const t = document.querySelector('#gMsgs .msg[data-key="' + key + '"] .tick'); if (t) t.textContent = " ✓";
  } catch (err) {
    pendingKeys.delete(key);
    const el = document.querySelector('#gMsgs .msg[data-key="' + key + '"]'); if (el) el.remove();
    toast("Message not sent. Check your connection. You may also be muted.");
    if (grpId === gid) { $("gInput").value = text; autosize($("gInput")); }
  }
});
$("gMenuBtn").onclick = () => {
  const items = [{ label: "👥  Group info", fn: openGroupInfo }];
  if (myRole() !== "a") items.push({ label: "Leave group", danger: true, fn: askLeaveGroup });
  openMenu($("gMenuBtn"), items);
};
$("gHead").onclick = () => openGroupInfo();

// ---- group info ----
function openGroupInfo() {
  if (!grpOpen || grpInfoOpen) return;
  grpInfoOpen = true; history.pushState({ gi: true }, "");
  show("ginfo"); renderGroupInfo();
}
function closeGroupInfo() { if (!grpInfoOpen) return; grpInfoOpen = false; show("grp"); }
function renderGroupInfo() {
  const me = myRole(), admin = me === "a", name = grpMeta ? grpMeta.name : "";
  drawAv($("giPic"), grpMeta && grpMeta.ph ? { ph: grpMeta.ph } : null, name || "G");
  $("giNameView").textContent = name; $("giNameView").hidden = admin;
  $("giNameRow").hidden = !admin;
  if (admin && document.activeElement !== $("giNameInput")) $("giNameInput").value = name;
  $("giPicBtns").hidden = !admin; $("giPicRemove").hidden = !(grpMeta && grpMeta.ph);
  $("giAdmin").hidden = !admin; $("giMr").checked = !!(grpMeta && grpMeta.mr);
  $("giLeave").hidden = admin; $("giDelete").hidden = !admin;
  const ids = Object.keys(grpMembers).sort((a, b) => ("amu".indexOf(roleOf(a)) - "amu".indexOf(roleOf(b))) || ((grpMembers[a].j || 0) - (grpMembers[b].j || 0)));
  $("giCount").textContent = "MEMBERS (" + ids.length + ")";
  const list = $("giList"); list.innerHTML = "";
  ids.forEach((u) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "giMem";
    const av = document.createElement("div"); av.className = "av"; av.textContent = "?";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = nameCache[u] || "…";
    const r = roleOf(u);
    const tag = (txt, cls) => { const t = document.createElement("span"); t.className = "gTag " + cls; t.textContent = txt; return t; };
    b.append(av, nm);
    if (r === "a") b.append(tag("Admin", "")); else if (r === "m") b.append(tag("Moderator", "mod"));
    if (isMuted(grpMembers[u])) b.append(tag("Muted", "mute"));
    if (u === uid) { const y = document.createElement("span"); y.style.cssText = "color:var(--muted);font-size:12px"; y.textContent = "You"; b.append(y); }
    b.onclick = () => openMemberSheet(u);
    list.append(b);
    getName(u).then((n) => { nm.textContent = n || "Unknown user"; av.textContent = (n || "?")[0].toUpperCase(); paintAv(av, u, n); });
  });
  const chips = $("giChips"); chips.innerHTML = "";
  if (admin) {
    const seen = new Set();
    Object.values(inboxCache).forEach((e) => {
      if (!e || !e.with || grpMembers[e.with] || blocksCache[e.with] || seen.has(e.with) || seen.size >= 8) return;
      seen.add(e.with);
      const b = document.createElement("button"); b.type = "button"; b.textContent = "+ …";
      b.onclick = () => addMember(e.with);
      chips.append(b); getName(e.with).then((n) => { b.textContent = "+ " + (n || "user"); });
    });
  }
}
$("giNameRow").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("giNameInput").value.trim().replace(/\s+/g, " ");
  if (!name || !grpId || myRole() !== "a") return;
  try { await set(ref(db, "groups/" + grpId + "/meta/name"), name.slice(0, 30)); toast("Name saved."); } catch (err) { toast("Couldn't save the name."); }
});
$("giPicChange").onclick = () => { gFileMode = "edit"; $("gFile").click(); };
$("giPicRemove").onclick = async () => { try { await remove(ref(db, "groups/" + grpId + "/meta/ph")); } catch (e) { toast("Couldn't remove the picture."); } };
$("giMr").onchange = async () => {
  try { await set(ref(db, "groups/" + grpId + "/meta/mr"), $("giMr").checked); }
  catch (e) { toast("Couldn't change that."); $("giMr").checked = !!(grpMeta && grpMeta.mr); }
};
async function addMember(u) {
  if (!grpId || myRole() !== "a" || !u) return;
  if (grpMembers[u]) { toast("Already in the group."); return; }
  if (Object.keys(grpMembers).length >= GROUP_MAX) { toast("A group holds up to " + GROUP_MAX + " people."); return; }
  const gid = grpId;
  try { await set(ref(db, "groups/" + gid + "/members/" + u), { r: "u", j: serverTimestamp() }); }
  catch (e) { toast("Couldn't add them. They may have blocked you."); return; }
  try { await set(ref(db, "userGroups/" + u + "/" + gid), true); } catch (e) {}
  toast(((await getName(u)) || "They") + " was added.");
}
$("giAddForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("giAddInput").value.trim();
  if (!v) return;
  if (!validName(v)) { toast("Usernames are 3–15 letters, numbers or _"); return; }
  $("giAddBtn").disabled = true;
  try {
    const other = (await withTimeout(get(ref(db, "names/" + v.toLowerCase())), 10000)).val();
    if (!other) toast("No user named “" + v + "”.");
    else if (other === uid) toast("That's you 🙂");
    else { $("giAddInput").value = ""; await addMember(other); }
  } catch (err) { toast("Couldn't search. Check your connection."); }
  $("giAddBtn").disabled = false;
});
// ---- member actions (admin / moderator) ----
function openMemberSheet(u) {
  const me = myRole(), tr = roleOf(u), box = $("gActBox");
  if (!me || me === "u" || u === uid || tr === "a") return;
  const canMute = me === "a" || (me === "m" && tr === "u");
  const canRemove = me === "a" || (me === "m" && tr === "u" && grpMeta && grpMeta.mr === true);
  box.innerHTML = "";
  const head = document.createElement("div"); head.className = "mmPrev"; head.textContent = (nameCache[u] || "Member") + (tr === "m" ? " · Moderator" : "");
  box.append(head);
  const add = (label, fn, danger) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (danger) b.className = "dng";
    b.onclick = async () => { $("gActSheet").classList.remove("open"); try { await fn(); } catch (e) { toast("Couldn't do that. You may not have permission."); } };
    box.append(b);
  };
  const gid = grpId, mp = (f) => ref(db, "groups/" + gid + "/members/" + u + "/" + f);
  if (me === "a") add(tr === "m" ? "Remove as moderator" : "Make moderator", () => set(mp("r"), tr === "m" ? "u" : "m"));
  if (canMute) {
    if (isMuted(grpMembers[u])) add("Unmute", () => remove(mp("mu")));
    else {
      add("Mute for 1 hour", () => set(mp("mu"), Date.now() + 3600000));
      add("Mute for 1 day", () => set(mp("mu"), Date.now() + 86400000));
      add("Mute until unmuted", () => set(mp("mu"), MUTE_FOR_EVER));
    }
  }
  if (canRemove) add("Remove from group", async () => {
    await remove(ref(db, "groups/" + gid + "/members/" + u));
    try { await remove(ref(db, "userGroups/" + u + "/" + gid)); } catch (e) {}
    toast("Removed.");
  }, true);
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.onclick = () => $("gActSheet").classList.remove("open"); box.append(cancel);
  if (box.querySelectorAll("button").length <= 1) return;
  $("gActSheet").classList.add("open");
}
$("gActSheet").onclick = (e) => { if (e.target.id === "gActSheet") $("gActSheet").classList.remove("open"); };
// ---- leave / delete ----
function askLeaveGroup() {
  const gid = grpId; if (!gid) return;
  askConfirm("Leave this group?", "You will stop getting its messages. An admin has to add you again if you want to come back.", "Leave", async () => {
    grpLeaving = true;
    try {
      await remove(ref(db, "groups/" + gid + "/members/" + uid));
      try { await remove(ref(db, "userGroups/" + uid + "/" + gid)); } catch (e) {}
      delete grpList[gid]; delete grpCache[gid];
      if (grpInfoOpen) { grpInfoOpen = false; }
      leaveGroup(); toast("You left the group.");
    } catch (e) { grpLeaving = false; toast("Couldn't leave. Check your connection."); }
  });
}
$("giLeave").onclick = askLeaveGroup;
$("giDelete").onclick = () => {
  const gid = grpId; if (!gid || myRole() !== "a") return;
  askConfirm("Delete this group?", "This deletes the group, every message and all photos and voice messages in it, for everybody. It cannot be undone.", "Delete group", async () => {
    grpLeaving = true;
    try {
      try { await remove(ref(db, "groupMedia/" + gid)); } catch (e) {}
      await remove(ref(db, "groups/" + gid));
      try { await remove(ref(db, "userGroups/" + uid + "/" + gid)); } catch (e) {}
      delete grpList[gid]; delete grpCache[gid];
      leaveGroup(); toast("Group deleted.");
    } catch (e) { grpLeaving = false; toast("Couldn't delete. Check your connection."); }
  });
};

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
  if (grpOpen) leaveGroup();
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

// ---------- Notifications ----------
// Two switches in Settings (chatrooms / personal chats) plus a sound switch.
//  - App open:        a small popup at the top (picture, name, preview) and a soft chime.
//  - App in background (still running): a normal Android notification (APK) or browser notification (PWA).
//  - App fully closed: Android can't wake the app without a push server, which needs a paid plan.
// Nothing here uses extra storage; it listens only for NEW messages and ignores your own,
// blocked people, and the chat you are looking at.
const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
const nPref = (k) => { try { return localStorage.getItem("bukchat-n-" + k) !== "off"; } catch (e) { return true; } };
const nSave = (k, v) => { try { localStorage.setItem("bukchat-n-" + k, v ? "on" : "off"); } catch (e) {} };
let nRooms = nPref("rooms"), nDm = nPref("dm"), nSound = nPref("sound");
let appInactive = false, sysPerm = "unknown", notifReady = false, pendingOpen = null;
const inBackground = () => document.hidden || appInactive;
const nid = (str) => { let h = 7; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (Math.abs(h) % 2000000000) + 1; };

function renderNotifUI() {
  $("nRoomsToggle").textContent = nRooms ? "On" : "Off";
  $("nDmToggle").textContent = nDm ? "On" : "Off";
  $("nSoundToggle").textContent = nSound ? "On" : "Off";
  const t = $("nPermText"), b = $("nPermBtn");
  b.hidden = true; t.textContent = "";
  if (sysPerm === "granted") t.innerHTML = "Phone permission: <b>allowed ✓</b>";
  else if (sysPerm === "denied") { t.innerHTML = "Phone permission: <b class=\"bad\">blocked</b>"; b.textContent = "How to fix"; b.hidden = false; }
  else if (sysPerm === "prompt") { t.textContent = "Phone permission needed for alerts outside the app"; b.textContent = "Allow"; b.hidden = false; }
  else if (sysPerm === "none") t.textContent = "This browser can't show background alerts.";
}
async function checkPerm() {
  try {
    if (LN) { const r = await LN.checkPermissions(); sysPerm = r.display === "granted" ? "granted" : r.display === "denied" ? "denied" : "prompt"; }
    else if ("Notification" in window) sysPerm = Notification.permission === "default" ? "prompt" : Notification.permission;
    else sysPerm = "none";
  } catch (e) {}
  renderNotifUI();
}
async function askPerm() {
  if (sysPerm === "denied") { toast("Open Android Settings → Apps → BUKCHAT → Notifications and turn them on."); return; }
  try {
    if (LN) await LN.requestPermissions();
    else if ("Notification" in window) await Notification.requestPermission();
  } catch (e) {}
  await checkPerm();
}
$("nPermBtn").onclick = askPerm;
[["nRoomsToggle", "rooms"], ["nDmToggle", "dm"], ["nSoundToggle", "sound"]].forEach(([id, k]) => {
  $(id).onclick = () => {
    const v = !(k === "rooms" ? nRooms : k === "dm" ? nDm : nSound);
    if (k === "rooms") nRooms = v; else if (k === "dm") nDm = v; else nSound = v;
    nSave(k, v); renderNotifUI();
    if (k === "sound" && v) playNotifySound();
    if (v && k !== "sound" && sysPerm === "prompt") askPerm();   // first time on: ask the phone for permission
  };
});
function initNotifs() {
  if (notifReady) return;
  notifReady = true;
  if (LN) {
    LN.createChannel({ id: "messages", name: "Messages", description: "New message alerts", importance: 4, sound: "soft_chime.wav", vibration: false, visibility: 1 }).catch(() => {});
    // same popup, but a silent sound file, used when "Notification sound" is Off
    LN.createChannel({ id: "messages_quiet", name: "Messages (silent)", description: "New message alerts without sound", importance: 4, sound: "silent.wav", vibration: false, visibility: 1 }).catch(() => {});
    LN.addListener("localNotificationActionPerformed", (a) => openFromNotif(a && a.notification && a.notification.extra));
  }
  checkPerm().then(() => {
    let asked = false; try { asked = localStorage.getItem("bukchat-n-asked") === "1"; } catch (e) {}
    if (LN && sysPerm === "prompt" && !asked) {
      try { localStorage.setItem("bukchat-n-asked", "1"); } catch (e) {}
      setTimeout(askPerm, 3500);                         // after the lobby has settled
    }
  });
  if (pendingOpen) { const x = pendingOpen; pendingOpen = null; setTimeout(() => openFromNotif(x), 600); }
}
if (CapApp && CapApp.addListener) CapApp.addListener("appStateChange", (st) => {
  appInactive = !st.isActive;
  if (st.isActive && LN && LN.removeAllDeliveredNotifications) LN.removeAllDeliveredNotifications().catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && LN && LN.removeAllDeliveredNotifications) LN.removeAllDeliveredNotifications().catch(() => {});
});
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "open") openFromNotif(ev.data.data);
});

// A soft two-note chime made in code (quiet on purpose).
function playNotifySound() {
  if (!nSound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    [[1046.5, 0, 0.5, 0.07], [1568, 0.1, 0.55, 0.06]].forEach(([f, st, dur, vol]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f, t + st);
      g.gain.setValueAtTime(0.0001, t + st);
      g.gain.exponentialRampToValueAtTime(vol, t + st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + st + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + st); o.stop(t + st + dur + 0.02);
    });
  } catch (e) {}
}

// The popup shown while the app is open.
let bannerTimer = null, bannerAct = null;
function hideBanner() { clearTimeout(bannerTimer); $("nBanner").classList.remove("show"); }
function showBanner(n) {
  $("nbAv").textContent = (n.name[0] || "?").toUpperCase();
  paintAv($("nbAv"), n.from, n.name);
  const nm = $("nbName"); nm.textContent = n.name;
  if (n.label) { const sm = document.createElement("small"); sm.textContent = n.label; nm.append(sm); }
  $("nbMsg").textContent = n.text;
  bannerAct = () => openFromNotif(n.kind === "dm" ? { kind: "dm", from: n.from } : { kind: "room", id: n.key });
  $("nBanner").classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 4500);
}
$("nBanner").addEventListener("click", () => { const a = bannerAct; hideBanner(); if (a) a(); });
(() => {                                                 // swipe sideways or up to dismiss
  let x0 = 0, y0 = 0;
  const b = $("nBanner");
  b.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  b.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    if (Math.abs(t.clientX - x0) > 50 || y0 - t.clientY > 25) { bannerAct = null; hideBanner(); }
  }, { passive: true });
})();

// System notification (when the app is in the background). Same id = replaces the old one,
// and a short wait between alerts for the same chat keeps busy rooms from buzzing non-stop.
const sysLast = {}, sysTimer = {};
function postSystem(n) {
  const id = nid(n.key);
  const send = (x) => {
    sysLast[n.key] = Date.now();
    const title = x.kind === "room" ? x.name + " · " + x.label : x.name;
    const extra = x.kind === "dm" ? { kind: "dm", from: x.from } : { kind: "room", id: x.key };
    if (LN) {
      LN.schedule({ notifications: [{ id, title, body: x.text, channelId: nSound ? "messages" : "messages_quiet", smallIcon: "ic_stat_bukchat", iconColor: "#FF7A00", extra }] }).catch(() => {});
    } else if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((r) => r.showNotification(title, {
        body: x.text, tag: "bukchat-" + id, icon: "icon-192.png", badge: "icon-192.png", silent: !nSound, data: extra, renotify: true
      })).catch(() => {});
    }
  };
  const gap = n.kind === "room" ? 20000 : 4000, wait = (sysLast[n.key] || 0) + gap - Date.now();
  clearTimeout(sysTimer[n.key]);
  if (wait <= 0) send(n); else sysTimer[n.key] = setTimeout(() => send(n), wait);
}
const bannerLast = {};
function notifyIncoming(n) {
  if (!uid || n.from === uid || blocksCache[n.from]) return;
  if (!(n.kind === "dm" ? nDm : nRooms)) return;
  n.text = String(n.text || "").replace(/\s+/g, " ").slice(0, 120);
  if (inBackground()) { postSystem(n); return; }
  if (n.kind === "dm" && dmOpen && dmConvId === n.key) return;          // already looking at it
  if (n.kind === "room" && inRoom && ROOM === n.key) return;
  if (n.kind === "room") {                                              // at most one popup per room every 8 s
    if (Date.now() - (bannerLast[n.key] || 0) < 8000) return;
    bannerLast[n.key] = Date.now();
  }
  showBanner(n);
  playNotifySound();
}
async function openFromNotif(x) {
  if (!x || !x.kind) return;
  if (!uid) { pendingOpen = x; return; }
  closeMenu(); ["confirmSheet", "clearSheet", "userSheet", "sheet"].forEach((id) => $(id).classList.remove("open"));
  if (dmOpen) { if (x.kind === "dm" && dmOther === x.from) return; leaveDm(); }
  if (inRoom) { if (x.kind === "room" && ROOM === x.id) return; await leaveChat(true); }
  profileOpen = blockedOpen = settingsOpen = false;
  if (x.kind === "dm") openDm(x.from, "lobby");
  else { const r = ROOMS.find((q) => q.id === x.id); if (r) joinRoom(r); }
}

// Watch for new messages in the rooms you belong to (only rooms you have opened before).
let roomNotifOff = {}, srvOffset = 0;
async function startRoomNotifs() {
  const me = uid;
  try { srvOffset = Number((await get(ref(db, ".info/serverTimeOffset"))).val()) || 0; } catch (e) {}
  await Promise.all(ROOMS.map(async (room) => {
    try {
      const sn = await get(ref(db, room.id + "/members/" + me + "/since"));
      if (sn.exists() && uid === me) watchRoomNotif(room);
    } catch (e) {}
  }));
}
function watchRoomNotif(room) {
  if (!uid || roomNotifOff[room.id]) return;
  const from = Date.now() + srvOffset - 2000;
  const q = query(ref(db, room.id + "/messages"), orderByChild("ts"), startAt(from), limitToLast(5));
  roomNotifOff[room.id] = onChildAdded(q, (snap) => {
    const m = snap.val();
    if (!m || typeof m.text !== "string" || !m.uid || m.uid === uid) return;
    if (typeof m.ts === "number" && m.ts < from) return;
    notifyIncoming({ kind: "room", key: room.id, from: m.uid, name: m.name || "Someone", text: m.text, label: room.emoji + " " + room.name });
  });
}
function stopRoomNotifs() {
  Object.values(roomNotifOff).forEach((f) => { try { f(); } catch (e) {} });
  roomNotifOff = {};
  hideBanner();
}
renderNotifUI();

// ---------- Stories ----------
// Nothing here runs until you open the Stories tab, and there are no live listeners.
//   storyIndex/<uid>        = { exp, ts, s: { <id>: "a:<time>" } }   a small list of who has stories (a=everyone f=friends h=hide-list)
//   stories/<uid>/<id>      = { k:'t'|'p'|'v', tx|cap, col, bg, m (picture/video), d, aud, ts, exp }
//   storyViews/<uid>/<id>/<viewer> = time        (only the owner can read this list)
//   storyHide/<uid>/<victim> = true               (people hidden from your "Hide from…" stories)
// A story is unreadable after 24 h (enforced by the database rules). The leftover data is deleted
// by whoever opens the Stories tab next (there is no server to do it for us on the free plan).
const ST_LIFE = 86400000, ST_VISIBLE = ST_LIFE - 120000, ST_MAX_MINE = 10;
const ST_BG = ["linear-gradient(135deg,#ff7a00,#ff2d55)", "linear-gradient(135deg,#4facfe,#00f2fe)", "linear-gradient(135deg,#43e97b,#38f9d7)", "linear-gradient(135deg,#a18cd1,#fbc2eb)", "linear-gradient(135deg,#f6d365,#fda085)", "linear-gradient(135deg,#232526,#414345)", "linear-gradient(135deg,#0f2027,#2c5364)", "linear-gradient(135deg,#f093fb,#f5576c)", "linear-gradient(135deg,#667eea,#764ba2)", "linear-gradient(135deg,#11998e,#38ef7d)"];
const ST_COL = ["#ffffff", "#ffd60a", "#ff7a00", "#ff4d6d", "#4dd2ff", "#3ddc84", "#c77dff", "#111111"];
const ST_EMO = ["😀", "😂", "😍", "🔥", "👍", "🎉", "❤️", "😎"];
const srvNow = () => Date.now() + (srvOffset || 0);
let seenSt = {};
try { seenSt = JSON.parse(localStorage.getItem("bukchat-st-seen") || "{}") || {}; } catch (e) {}
function markSeen(sid) {
  if (seenSt[sid]) return;
  seenSt[sid] = 1;
  const k = Object.keys(seenSt);
  if (k.length > 300) k.slice(0, k.length - 300).forEach((x) => delete seenSt[x]);
  try { localStorage.setItem("bukchat-st-seen", JSON.stringify(seenSt)); } catch (e) {}
}
const stAgo = (ts) => {
  const m = Math.max(0, Math.round((srvNow() - ts) / 60000));
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
};
const stEntries = (v) => Object.entries((v && v.s) || {}).map(([sid, val]) => ({ sid, aud: String(val)[0], ts: Number(String(val).slice(2)) || 0 }));
const isFriend = (u) => Object.values(inboxCache).some((e) => e && e.with === u);

let stUsers = [], stMine = [], stLoadedAt = 0, stBusy = false;
const stCache = {};
async function loadStories(force) {
  if (!uid) return;
  if (!force && stLoadedAt && Date.now() - stLoadedAt < 60000) { renderStories(); return; }
  if (stBusy) return;
  stBusy = true;
  $("stRefresh").disabled = true;
  if (!stLoadedAt) { $("stLoading").hidden = false; $("stEmpty").hidden = true; }
  try {
    if (!srvOffset) { try { srvOffset = Number((await get(ref(db, ".info/serverTimeOffset"))).val()) || 0; } catch (e) {} }
    const [mine, feed] = await Promise.all([
      get(ref(db, "storyIndex/" + uid)),
      get(query(ref(db, "storyIndex"), orderByChild("ts"), limitToLast(40)))
    ]);
    const now = srvNow(), users = [], dead = [];
    const all = feed.exists() ? Object.entries(feed.val()) : [];
    if (mine.exists() && !all.some(([u]) => u === uid)) all.push([uid, mine.val()]);
    all.forEach(([u, v]) => {
      const list = stEntries(v);
      list.filter((e) => now - e.ts >= ST_LIFE).forEach((e) => dead.push([u, e.sid, list.length]));
      const live = list.filter((e) => now - e.ts < ST_VISIBLE).sort((a, b) => a.ts - b.ts);
      if (u === uid) { stMine = live; return; }
      if (blocksCache[u]) return;
      const shown = live.filter((e) => e.aud !== "f" || isFriend(u));   // "friends only" is for people you've chatted with
      if (shown.length) users.push({ uid: u, list: shown, last: shown[shown.length - 1].ts });
    });
    if (!all.some(([u]) => u === uid)) stMine = [];
    stUsers = users.sort((a, b) => b.last - a.last);
    stLoadedAt = Date.now();
    cleanupStories(all, dead, now);
  } catch (e) {
    toast("Couldn't load stories. Check your connection.");
  }
  stBusy = false;
  $("stRefresh").disabled = false;
  $("stLoading").hidden = true;
  renderStories();
}
// Delete stories older than 24 h (at most a few each time, so opening the tab stays quick).
async function cleanupStories(all, dead, now) {
  const byUser = {};
  dead.forEach(([u, sid]) => { (byUser[u] = byUser[u] || []).push(sid); });
  let n = 0;
  for (const [u, sids] of Object.entries(byUser)) {
    if (n++ >= 5) break;
    const v = (all.find((x) => x[0] === u) || [])[1];
    const everyoneDead = stEntries(v).every((e) => now - e.ts >= ST_LIFE);
    for (const sid of sids) {
      for (const path of ["stories/" + u + "/" + sid, "storyViews/" + u + "/" + sid]) { try { await remove(ref(db, path)); } catch (e) {} }
      if (!everyoneDead) { try { await remove(ref(db, "storyIndex/" + u + "/s/" + sid)); } catch (e) {} }
    }
    if (everyoneDead) { try { await remove(ref(db, "storyIndex/" + u)); } catch (e) {} }
  }
}
function stRow(u, name, list, mine) {
  const b = document.createElement("button");
  b.className = "stItem"; b.type = "button";
  const ring = document.createElement("div");
  ring.className = "stRing" + (list.every((e) => seenSt[e.sid]) ? " seen" : "");
  const av = document.createElement("div"); av.className = "av"; av.textContent = (name[0] || "?").toUpperCase();
  paintAv(av, u, name);
  ring.append(av);
  const mid = document.createElement("div");
  const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = mine ? "My story" : name;
  const sb = document.createElement("div"); sb.className = "sb";
  sb.textContent = list.length + (list.length === 1 ? " story · " : " stories · ") + stAgo(list[list.length - 1].ts);
  mid.append(nm, sb);
  b.append(ring, mid);
  b.onclick = () => openStoryView(u, name, list);
  return b;
}
function renderStories() {
  const mineBox = $("stMine"), list = $("stList");
  mineBox.innerHTML = ""; list.innerHTML = "";
  if (stMine.length) mineBox.append(stRow(uid, myName || "Me", stMine, true));
  stUsers.forEach((x) => {
    const row = stRow(x.uid, nameCache[x.uid] || "…", x.list, false);
    list.append(row);
    getName(x.uid).then((n) => { row.querySelector(".nm").textContent = n || "User"; row.querySelector(".av").dataset.pn = n || ""; paintAv(row.querySelector(".av"), x.uid, n); row.onclick = () => openStoryView(x.uid, n || "User", x.list); });
  });
  $("stEmpty").hidden = stUsers.length > 0 || stMine.length > 0 || stBusy;
}
$("stRefresh").onclick = () => loadStories(true);

// ----- drawing one story (used by the viewer and the preview) -----
function drawFrame(el, st) {
  el.innerHTML = "";
  if (st.k === "t") {
    el.style.background = ST_BG[st.bg || 0] || ST_BG[0];
    const t = document.createElement("div"); t.className = "stText";
    t.textContent = st.tx || ""; t.style.color = st.col || "#fff";
    el.append(t);
  } else if (st.m) {
    el.style.background = "#000";
    const m = document.createElement(st.k === "v" ? "video" : "img");
    if (st.k === "v") { m.muted = true; m.autoplay = true; m.loop = true; m.playsInline = true; m.setAttribute("playsinline", ""); }
    m.src = st.m; el.append(m);
    if (st.k === "v") m.play().catch(() => {});
    if (st.cap) { const c = document.createElement("div"); c.className = "stCap"; c.textContent = st.cap; c.style.color = st.col || "#fff"; el.append(c); }
  }
}

// ----- full-screen viewer -----
let sv = null, svReturn = "lobby";
function fetchStory(u, sid) {
  const k = u + "/" + sid;
  if (!(k in stCache)) {
    stCache[k] = get(ref(db, "stories/" + u + "/" + sid)).then((s) => (s.exists() ? s.val() : null)).catch(() => null);
    const keys = Object.keys(stCache);
    if (keys.length > 6) delete stCache[keys[0]];            // keep memory small (pictures are big)
  }
  return stCache[k];
}
function openStoryView(u, name, list) {
  if (sv || !list.length) return;
  const mine = u === uid;
  sv = { uid: u, name, list: list.slice(), i: 0, token: 0, timer: null, mine, dur: 0, t0: 0, left: 0, paused: false };
  const firstNew = sv.list.findIndex((e) => !seenSt[e.sid]);
  sv.i = !mine && firstNew > 0 ? firstNew : 0;
  svReturn = document.querySelector(".screen.active") ? document.querySelector(".screen.active").id : "lobby";
  history.pushState({ story: true }, "");
  $("svName").textContent = mine ? "My story" : name;
  $("svAv").textContent = (name[0] || "?").toUpperCase(); $("svAv").dataset.pn = name; paintAv($("svAv"), u, name);
  $("svDel").hidden = !mine; $("svViews").hidden = !mine; $("svReplyForm").hidden = mine || !!blocksCache[u];
  $("svReplyInput").value = "";
  const bars = $("svBars"); bars.innerHTML = "";
  sv.list.forEach(() => { const i = document.createElement("i"); i.append(document.createElement("b")); bars.append(i); });
  show("storyView");
  showStory();
}
async function showStory() {
  if (!sv) return;
  clearTimeout(sv.timer);
  const my = ++sv.token, e = sv.list[sv.i];
  [...$("svBars").children].forEach((bar, j) => {
    bar.classList.toggle("done", j < sv.i);
    const b = bar.firstChild; b.style.transition = "none"; b.style.width = j < sv.i ? "100%" : "0";
  });
  $("svTime").textContent = stAgo(e.ts);
  $("svFrame").innerHTML = ""; $("svFrame").style.background = "#000";
  const st = await fetchStory(sv.uid, e.sid);
  if (!sv || my !== sv.token) return;
  if (!st || (st.exp && st.exp < srvNow())) {              // gone, expired or not allowed for me
    sv.list.splice(sv.i, 1);
    if ($("svBars").lastChild) $("svBars").removeChild($("svBars").lastChild);
    if (!sv.list.length) { closeStoryView(); toast("That story isn't available any more."); return; }
    if (sv.i >= sv.list.length) { closeStoryView(); return; }
    showStory(); return;
  }
  drawFrame($("svFrame"), st);
  markSeen(e.sid);
  sv.dur = st.k === "v" ? Math.max(2, Math.min(9, Number(st.d) || 8)) * 1000 : 5000;
  startBar(sv.dur);
  const nx = sv.list[sv.i + 1]; if (nx) fetchStory(sv.uid, nx.sid);      // get the next one ready
  if (sv.mine) loadViewCount(e.sid, my);
  else if (!seenViewed[e.sid]) { seenViewed[e.sid] = 1; set(ref(db, "storyViews/" + sv.uid + "/" + e.sid + "/" + uid), serverTimestamp()).catch(() => {}); }
}
const seenViewed = {};
function startBar(ms, from) {
  const bar = $("svBars").children[sv.i].firstChild;
  bar.style.transition = "none"; bar.style.width = (from || 0) * 100 + "%";
  void bar.offsetWidth;
  bar.style.transition = "width " + ms + "ms linear"; bar.style.width = "100%";
  sv.t0 = Date.now(); sv.left = ms; sv.paused = false;
  clearTimeout(sv.timer);
  sv.timer = setTimeout(stNext, ms);
  const v = $("svFrame").querySelector("video"); if (v) v.play().catch(() => {});
}
function pauseSt(on) {
  if (!sv) return;
  if (on && !sv.paused) {
    sv.paused = true; clearTimeout(sv.timer);
    sv.left = Math.max(300, sv.left - (Date.now() - sv.t0));
    const bar = $("svBars").children[sv.i] && $("svBars").children[sv.i].firstChild;
    if (bar) { const w = bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width; bar.style.transition = "none"; bar.style.width = w * 100 + "%"; }
    const v = $("svFrame").querySelector("video"); if (v) v.pause();
  } else if (!on && sv.paused) {
    const bar = $("svBars").children[sv.i].firstChild;
    const done = parseFloat(bar.style.width) / 100 || 0;
    startBar(sv.left, done);
  }
}
function stNext() { if (!sv) return; if (sv.i < sv.list.length - 1) { sv.i++; showStory(); } else closeStoryView(); }
function stPrev() { if (!sv) return; if (sv.i > 0) sv.i--; showStory(); }
function closeStoryView(fromPop) {
  if (!sv) return;
  clearTimeout(sv.timer); sv = null;
  $("svFrame").innerHTML = ""; $("stViewers").classList.remove("open");
  show(svReturn === "storyView" ? "lobby" : svReturn);
  renderStories();
}
$("svNext").onclick = stNext; $("svPrev").onclick = stPrev;
$("svClose").onclick = () => { if (CapApp) closeStoryView(); else history.back(); };
(() => {                                                    // swipe down to close
  let y0 = 0;
  const st = $("storyView");
  st.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  st.addEventListener("touchend", (e) => { if (e.changedTouches[0].clientY - y0 > 110 && sv) $("svClose").click(); }, { passive: true });
})();
$("svReplyInput").addEventListener("focus", () => pauseSt(true));
$("svReplyInput").addEventListener("blur", () => setTimeout(() => { if (sv && !$("svReplyInput").value.trim()) pauseSt(false); }, 150));
$("svReplyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("svReplyInput").value.trim();
  if (!text || !sv || sv.mine) return;
  if (blocksCache[sv.uid]) { toast("Unblock this user to reply."); return; }
  const other = sv.uid, conv = dmConv(uid, other);
  $("svReplyInput").value = ""; $("svReplyInput").blur();
  playSendSound();
  // Replies go into the normal private chat, so the usual DM rules apply.
  if (!inboxCache[conv]) {
    const a = uid < other ? uid : other, b = uid < other ? other : uid;
    try { await set(ref(db, "dms/" + conv + "/meta"), { a, b }); } catch (err) {}
  }
  const ok = await dmWrite(conv, other, push(ref(db, "dms/" + conv + "/messages")).key, ("↩ Story reply: " + text).slice(0, 500));
  toast(ok ? "Reply sent to " + sv.name + " 💬" : "Couldn't send the reply.");
  if (sv) pauseSt(false);
});
async function loadViewCount(sid, my) {
  $("svViewN").textContent = "…";
  try {
    const sn = await get(ref(db, "storyViews/" + uid + "/" + sid));
    if (sv && my === sv.token) { sv.views = sn.exists() ? sn.val() : {}; $("svViewN").textContent = Object.keys(sv.views).length; }
  } catch (e) { if (sv && my === sv.token) $("svViewN").textContent = "0"; }
}
$("svViews").onclick = () => {
  if (!sv || !sv.mine) return;
  pauseSt(true);
  const ul = $("stViewList"); ul.innerHTML = "";
  const rows = Object.entries(sv.views || {}).sort((a, b) => b[1] - a[1]);
  $("stViewEmpty").hidden = rows.length > 0;
  rows.forEach(([u, ts]) => {
    const li = document.createElement("li");
    const av = document.createElement("div"); av.className = "av"; av.textContent = "?";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = "…";
    const tm = document.createElement("small"); tm.textContent = stAgo(Number(ts) || srvNow());
    li.append(av, nm, tm); ul.append(li);
    getName(u).then((n) => { nm.textContent = n || "User"; av.textContent = ((n || "?")[0]).toUpperCase(); paintAv(av, u, n); });
  });
  $("stViewers").classList.add("open");
};
$("stViewers").onclick = (e) => { if (e.target.id === "stViewers") { $("stViewers").classList.remove("open"); pauseSt(false); } };
$("svDel").onclick = () => {
  if (!sv || !sv.mine) return;
  pauseSt(true);
  const e = sv.list[sv.i], sid = e.sid;
  askConfirm("Delete this story?", "It will disappear for everyone right away.", "Delete", async () => {
    const left = stMine.filter((x) => x.sid !== sid);
    const u = {};
    u["stories/" + uid + "/" + sid] = null; u["storyViews/" + uid + "/" + sid] = null;
    if (left.length) u["storyIndex/" + uid + "/s/" + sid] = null; else u["storyIndex/" + uid] = null;
    try { await update(ref(db), u); } catch (err) { toast("Couldn't delete. Check your connection."); return; }
    delete stCache[uid + "/" + sid];
    stMine = left; stLoadedAt = 0;
    if (!sv) return;
    sv.list.splice(sv.i, 1);
    const bars = $("svBars"); bars.removeChild(bars.lastChild);
    toast("Story deleted");
    if (!sv.list.length) { closeStoryView(); return; }
    if (sv.i >= sv.list.length) sv.i = sv.list.length - 1;
    showStory();
  });
  const stop = () => { if ($("clearSheet").classList.contains("open")) setTimeout(stop, 300); else pauseSt(false); };
  setTimeout(stop, 300);
};

// ----- making a story -----
let sn = null, snOpen = false;
function snResetState() { sn = { k: null, m: null, d: 0, bg: 0, col: "#ffffff", aud: "a", hide: new Set(), hideLoaded: false, busy: false }; }
async function openStoryNew() {
  if (stMine.length >= ST_MAX_MINE) { toast("You can have up to " + ST_MAX_MINE + " stories at a time. Delete one first."); return; }
  snResetState();
  snOpen = true;
  history.pushState({ snew: true }, "");
  document.querySelectorAll(".snKinds button").forEach((b) => b.classList.remove("on"));
  document.querySelectorAll("#snAud button").forEach((b) => b.classList.toggle("on", b.dataset.a === "a"));
  $("snTx").value = ""; $("snCap").value = "";
  $("snTx").hidden = $("snCap").hidden = $("snTools").hidden = $("snHideBox").hidden = true;
  $("snNote").textContent = ""; $("snPost").disabled = true;
  $("snAudNote").textContent = "Everyone on BUKCHAT can see it.";
  $("snFrame").innerHTML = '<div class="stHint">Choose Photo, Video or Text above</div>'; $("snFrame").style.background = "#000";
  show("storyNew");
}
function closeStoryNew(fromPop) {
  if (!snOpen) return;
  snOpen = false; sn = null;
  show("lobby");
}
$("stAddBtn").onclick = openStoryNew;
$("snBack").onclick = () => { if (CapApp) closeStoryNew(); else history.back(); };

function buildTools() {
  const emo = $("snEmo"), cols = $("snCols"), bgs = $("snBgs");
  if (emo.childElementCount) return;
  ST_EMO.forEach((e) => { const b = document.createElement("button"); b.type = "button"; b.textContent = e; b.onclick = () => insertEmoji(e); emo.append(b); });
  ST_COL.forEach((c) => { const b = document.createElement("button"); b.type = "button"; b.style.background = c; b.setAttribute("aria-label", "Text colour"); b.dataset.c = c; if (c === "#ffffff") b.classList.add("on"); b.onclick = () => { sn.col = c; cols.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); snPreview(); }; cols.append(b); });
  bgs.classList.add("bgs");
  ST_BG.forEach((g, i) => { const b = document.createElement("button"); b.type = "button"; b.style.background = g; b.setAttribute("aria-label", "Background"); if (i === 0) b.classList.add("on"); b.onclick = () => { sn.bg = i; bgs.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); snPreview(); }; bgs.append(b); });
}
function insertEmoji(e) {
  const f = sn && sn.k === "t" ? $("snTx") : $("snCap");
  const a = f.selectionStart == null ? f.value.length : f.selectionStart, z = f.selectionEnd == null ? a : f.selectionEnd;
  if ((f.value.slice(0, a) + e + f.value.slice(z)).length > f.maxLength) return;
  f.value = f.value.slice(0, a) + e + f.value.slice(z);
  f.setSelectionRange(a + e.length, a + e.length);
  snPreview();
}
function snStory() {
  return { k: sn.k, tx: $("snTx").value.trim(), cap: $("snCap").value.trim(), col: sn.col, bg: sn.bg, m: sn.m };
}
function snPreview() {
  if (!sn || !sn.k) return;
  const st = snStory();
  if (st.k === "t") drawFrame($("snFrame"), st);
  else if (sn.m) {
    // update only the caption so the video doesn't restart on every keystroke
    const fr = $("snFrame");
    if (!fr.querySelector("img,video")) drawFrame(fr, st);
    let c = fr.querySelector(".stCap");
    if (st.cap) { if (!c) { c = document.createElement("div"); c.className = "stCap"; fr.append(c); } c.textContent = st.cap; c.style.color = st.col; } else if (c) c.remove();
  }
  $("snPost").disabled = sn.busy || (st.k === "t" ? !st.tx : !sn.m);
}
document.querySelectorAll(".snKinds button").forEach((b) => b.onclick = () => {
  if (!sn || sn.busy) return;
  buildTools();
  const k = b.dataset.k;
  document.querySelectorAll(".snKinds button").forEach((x) => x.classList.toggle("on", x === b));
  sn.k = k; sn.m = null; sn.d = 0;
  $("snTools").hidden = false;
  $("snTx").hidden = k !== "t"; $("snCap").hidden = k === "t"; $("snBgs").hidden = k !== "t";
  $("snNote").textContent = "";
  $("snFrame").innerHTML = '<div class="stHint">' + (k === "t" ? "Type your story below" : "Pick a " + (k === "p" ? "photo" : "video") + "…") + "</div>";
  $("snFrame").style.background = "#000";
  if (k === "t") { snPreview(); $("snTx").focus(); }
  else { $("snFile").accept = k === "p" ? "image/*" : "video/*"; $("snFile").click(); $("snPost").disabled = true; }
});
$("snTx").addEventListener("input", snPreview);
$("snCap").addEventListener("input", snPreview);
$("snFile").onchange = async () => {
  const f = $("snFile").files && $("snFile").files[0];
  $("snFile").value = "";
  if (!f || !sn) return;
  const k = sn.k;
  sn.busy = true; $("snPost").disabled = true;
  try {
    if (k === "p") {
      if (!/^image\//.test(f.type)) throw new Error("type");
      $("snNote").textContent = "Preparing photo…";
      sn.m = await shrinkStoryPhoto(f);
    } else {
      if (!/^video\//.test(f.type)) throw new Error("type");
      const r = await prepStoryVideo(f, (pct) => { $("snNote").textContent = "Preparing video… " + pct + "%"; });
      sn.m = r.data; sn.d = r.d;
    }
    $("snNote").textContent = k === "v" ? "Video ready (" + Math.round(sn.d) + " s, no sound)" : "";
    $("snFrame").innerHTML = "";
    drawFrame($("snFrame"), snStory());
  } catch (e) {
    sn.m = null;
    $("snNote").textContent = e && e.message === "long" ? "That video is too big even after shrinking. Try a shorter one." : "Couldn't use that file. Try another one.";
  }
  if (sn) { sn.busy = false; snPreview(); }
};
// Photos: shrink to at most 720 px and ~70% quality (usually 40-90 KB).
function shrinkStoryPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      try {
        let scale = Math.min(1, 720 / Math.max(im.naturalWidth, im.naturalHeight)), q = 0.72, out = "";
        for (let i = 0; i < 6; i++) {
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(im.naturalWidth * scale)); cv.height = Math.max(1, Math.round(im.naturalHeight * scale));
          const cx = cv.getContext("2d"); cx.fillStyle = "#000"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
          out = cv.toDataURL("image/jpeg", q);
          if (out.length < 150000) break;
          q = Math.max(0.45, q - 0.1); scale *= 0.85;
        }
        URL.revokeObjectURL(url);
        out.startsWith("data:image/jpeg") && out.length < 210000 ? resolve(out) : reject(new Error("big"));
      } catch (e) { reject(e); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    im.src = url;
  });
}
// Videos: at most 8 seconds, 480 px, about 300 kbps, no sound (plays back once through a small encoder).
function prepStoryVideo(file, onPct) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const fail = (m) => { URL.revokeObjectURL(url); reject(new Error(m)); };
    v.onerror = () => fail("load");
    v.onloadedmetadata = async () => {
      try {
        if (!v.videoWidth || !MediaRecorder) return fail("load");
        const dur = Math.min(8, isFinite(v.duration) ? v.duration : 8);
        const sc = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
        const cv = document.createElement("canvas");
        cv.width = Math.max(2, Math.round(v.videoWidth * sc / 2) * 2); cv.height = Math.max(2, Math.round(v.videoHeight * sc / 2) * 2);
        const cx = cv.getContext("2d");
        const mime = ["video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
        if (!mime) return fail("load");
        const rec = new MediaRecorder(cv.captureStream(24), { mimeType: mime, videoBitsPerSecond: 300000 });
        const parts = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        rec.onstop = () => {
          const blob = new Blob(parts, { type: "video/webm" });
          URL.revokeObjectURL(url);
          if (blob.size > 480000) return reject(new Error("long"));
          const fr = new FileReader();
          fr.onload = () => (String(fr.result).startsWith("data:video/webm;base64,") ? resolve({ data: fr.result, d: Math.max(1, dur) }) : reject(new Error("load")));
          fr.onerror = () => reject(new Error("load"));
          fr.readAsDataURL(blob);
        };
        rec.start(250);
        v.currentTime = 0;
        await v.play();
        const draw = () => {
          cx.drawImage(v, 0, 0, cv.width, cv.height);
          onPct(Math.min(99, Math.round(v.currentTime / dur * 100)));
          if (v.currentTime >= dur || v.ended) { v.pause(); rec.stop(); } else requestAnimationFrame(draw);
        };
        draw();
      } catch (e) { fail("load"); }
    };
  });
}
// Who can see it
document.querySelectorAll("#snAud button").forEach((b) => b.onclick = async () => {
  if (!sn) return;
  sn.aud = b.dataset.a;
  document.querySelectorAll("#snAud button").forEach((x) => x.classList.toggle("on", x === b));
  $("snAudNote").textContent = sn.aud === "a" ? "Everyone on BUKCHAT can see it." : sn.aud === "f" ? "Only people you have chatted with privately can see it." : "Everyone can see it except the people you tick below.";
  $("snHideBox").hidden = sn.aud !== "h";
  if (sn.aud === "h") await buildHideList();
});
async function buildHideList() {
  const box = $("snHideBox");
  if (!sn.hideLoaded) {
    sn.hideLoaded = true;
    try { const h = await get(ref(db, "storyHide/" + uid)); if (h.exists() && sn) Object.keys(h.val()).forEach((u) => sn.hide.add(u)); } catch (e) {}
  }
  box.innerHTML = "";
  const people = [...new Set(Object.values(inboxCache).filter((e) => e && e.with).map((e) => e.with))];
  if (!people.length) { box.innerHTML = '<div class="emptyNote" style="padding:14px">You haven\'t chatted with anyone yet, so there is nobody to hide it from.</div>'; return; }
  people.forEach((u) => {
    const row = document.createElement("label"); row.className = "hideRow";
    const av = document.createElement("div"); av.className = "av"; av.textContent = "?";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = nameCache[u] || "…";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = sn.hide.has(u);
    cb.onchange = () => { if (cb.checked) sn.hide.add(u); else sn.hide.delete(u); };
    row.append(av, nm, cb); box.append(row);
    getName(u).then((n) => { nm.textContent = n || "User"; av.textContent = ((n || "?")[0]).toUpperCase(); paintAv(av, u, n); });
  });
}
const newStoryId = () => {
  const a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, (x) => "0123456789abcdefghijklmnopqrstuvwxyz"[x % 36]).join("");
};
$("snPost").onclick = async () => {
  if (!sn || sn.busy || !sn.k) return;
  const st = snStory();
  if (st.k === "t" ? !st.tx : !sn.m) return;
  sn.busy = true; $("snPost").disabled = true; $("snNote").textContent = "Posting…";
  try {
    if (!srvOffset) { try { srvOffset = Number((await get(ref(db, ".info/serverTimeOffset"))).val()) || 0; } catch (e) {} }
    const sid = newStoryId(), now = srvNow(), exp = now + ST_LIFE - 120000;
    const story = { k: st.k, aud: sn.aud, ts: serverTimestamp(), exp };
    if (st.k === "t") { story.tx = st.tx; story.bg = st.bg; story.col = st.col; }
    else { story.m = sn.m; if (st.cap) { story.cap = st.cap; story.col = st.col; } if (st.k === "v") story.d = sn.d; }
    const u = {};
    u["stories/" + uid + "/" + sid] = story;
    u["storyIndex/" + uid + "/s/" + sid] = sn.aud + ":" + String(Math.round(now)).padStart(13, "0");
    u["storyIndex/" + uid + "/exp"] = exp;
    u["storyIndex/" + uid + "/ts"] = serverTimestamp();
    if (sn.aud === "h") {
      const old = new Set();
      try { const h = await get(ref(db, "storyHide/" + uid)); if (h.exists()) Object.keys(h.val()).forEach((x) => old.add(x)); } catch (e) {}
      sn.hide.forEach((x) => { if (!old.has(x)) u["storyHide/" + uid + "/" + x] = true; });
      old.forEach((x) => { if (!sn.hide.has(x)) u["storyHide/" + uid + "/" + x] = null; });
    }
    await withTimeout(update(ref(db), u), 20000);
    stLoadedAt = 0; Object.keys(stCache).forEach((k) => delete stCache[k]);
    snOpen = false; sn = null;
    show("lobby");
    toast("Story posted ✓");
    loadStories(true);
  } catch (e) {
    const wait = String((e && (e.code || e.message)) || "").toUpperCase().includes("PERMISSION");
    $("snNote").textContent = wait ? "Please wait a few seconds between stories, then try again." : "Couldn't post. Check your connection and try again.";
    if (sn) { sn.busy = false; $("snPost").disabled = false; }
  }
};

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
    try {   // leave my groups (and delete the ones I created)
      const mine = (await get(ref(db, "userGroups/" + me))).val() || {};
      for (const gid of Object.keys(mine)) {
        try {
          const role = (await get(ref(db, "groups/" + gid + "/members/" + me + "/r"))).val();
          if (role === "a") { try { await remove(ref(db, "groupMedia/" + gid)); } catch (e) {} await remove(ref(db, "groups/" + gid)); }
          else if (role) await remove(ref(db, "groups/" + gid + "/members/" + me));
        } catch (e) {}
      }
    } catch (e) {}
    for (const n of ["stories", "storyViews", "storyHide", "storyIndex", "hidden", "userGroups", "groupMake"]) { try { await remove(ref(db, n + "/" + me)); } catch (e) {} }
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
