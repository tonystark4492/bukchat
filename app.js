import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, EmailAuthProvider, linkWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  reauthenticateWithCredential, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, onChildAdded, remove,
  onDisconnect, serverTimestamp, query, limitToLast, orderByChild, startAt
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
  return { since: Number(since) || 0, greeted };
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
      }
      ul.append(li);
    });
  }));

  // Only messages from this member's joining point onward, newest 100 of those.
  const q = query(
    ref(db, ROOM + "/messages"),
    orderByChild("ts"),
    startAt(membership.since),
    limitToLast(100)
  );
  unsubs.push(onChildAdded(q, (snap) => {
    addMessage(snap.val());
  }));

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

function addMessage(m) {
  if (!m || typeof m.text !== "string") return;
  const box = $("msgs");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const mine = m.uid === uid;
  const d = document.createElement("div");
  d.className = "msg " + (mine ? "mine" : "other");
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = m.name || "?";
  const body = document.createElement("div");
  body.textContent = m.text;
  const tm = document.createElement("div");
  tm.className = "tm";
  tm.textContent = m.ts
    ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  d.append(who, body, tm);
  box.append(d);
  if (nearBottom || mine) box.scrollTop = box.scrollHeight;
}

$("sendForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msgInput").value.trim();
  if (!text) return;
  $("msgInput").value = "";
  try {
    await push(ref(db, ROOM + "/messages"), {
      uid, name: myName, text, ts: serverTimestamp()
    });
  } catch (err) {
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

$("backBtn").onclick = () => {
  if (inRoom) history.back();
};
window.addEventListener("popstate", () => {
  if (settingsOpen) { closeSettings(); return; }
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
  openMenu($("chatMenuBtn"), [{ label: "⚙️  Settings", fn: openSettings }]);

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
$("settingsBack").onclick = () => history.back();

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
    }
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
