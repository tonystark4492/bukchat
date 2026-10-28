import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, EmailAuthProvider, linkWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, onChildAdded, remove,
  onDisconnect, serverTimestamp, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig } from "./config.js";

const MAX_MEMBERS = 50;
const ROOM = "chatroom1";
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
let chatStartTime = 0;
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

$("logoutBtn").onclick = async () => {
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
};
$("accountBtn").onclick = () => enterRegister(true);

function enterLobby() {
  show("lobby");
  $("meName").textContent = myName;
  $("accountBtn").style.display =
    auth.currentUser && auth.currentUser.isAnonymous ? "inline-block" : "none";
  if (lobbyUnsub) lobbyUnsub();
  lobbyUnsub = onValue(ref(db, ROOM + "/slots"), (snap) => {
    const n = snap.exists() ? Object.keys(snap.val()).length : 0;
    $("roomCount").textContent = n + " / " + MAX_MEMBERS + " online";
    $("roomDot").classList.toggle("full", n >= MAX_MEMBERS);
  });
}

$("roomBtn").onclick = async () => {
  $("roomBtn").disabled = true;
  const ok = await claimSlot();
  $("roomBtn").disabled = false;
  if (!ok) {
    toast("Chatroom1 is full (50/50). Try again later.");
    return;
  }
  openChat();
};

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

function openChat() {
  inRoom = true;
  chatStartTime = 0;
  if (lobbyUnsub) {
    lobbyUnsub();
    lobbyUnsub = null;
  }
  show("chat");
  $("msgs").innerHTML = "";
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

  const q = query(ref(db, ROOM + "/messages"), limitToLast(100));
unsubs.push(onChildAdded(q, (snap) => {
  const message = snap.val();
  if (message && message.ts >= chatStartTime) {
    addMessage(message);
  }
}));

  unsubs.push(onValue(ref(db, ".info/connected"), async (s) => {
    if (s.val() === true && inRoom) {
      const ok = await claimSlot();
      if (!ok) {
        toast("Chatroom1 became full. You were moved out.");
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
  if (inRoom) leaveChat(true);
});
$("membersBtn").onclick = () => $("sheet").classList.add("open");
$("sheet").onclick = (e) => {
  if (e.target.id === "sheet") $("sheet").classList.remove("open");
};

boot();
