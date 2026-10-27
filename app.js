import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, onChildAdded, remove, onDisconnect,
  serverTimestamp, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig } from "./config.js";

const MAX_MEMBERS = 10;
const ROOM = "chatroom1";
const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
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

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- state ----------
let auth, db;
let uid = null;
let myName = null;
let mySlot = null;
let inRoom = false;
let unsubs = [];
const nameCache = {};

// ---------- boot ----------
const splashDone = new Promise((r) => setTimeout(r, 2000)); // exactly 2 seconds

async function boot() {
  $("retryBtn").style.display = "none";
  $("splashMsg").textContent = "";

  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
    await splashDone;
    $("splashMsg").textContent = "Setup needed: open config.js and paste your Firebase details (see SETUP.md).";
    return;
  }

  let route;
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);

    const user = await withTimeout(
      new Promise((resolve, reject) => {
        onAuthStateChanged(auth, (u) => { if (u) resolve(u); });
        signInAnonymously(auth).catch(reject);
      }),
      12000
    );
    uid = user.uid;

    const snap = await withTimeout(get(ref(db, "users/" + uid)), 12000);
    if (snap.exists()) {
      myName = snap.val().name;
      route = "lobby";
    } else {
      route = "register";
    }
  } catch (e) {
    await splashDone;
    const msg = String(e && e.code || e && e.message || e);
    $("splashMsg").textContent = msg.includes("admin-restricted") || msg.includes("operation-not-allowed")
      ? "Anonymous sign-in is not enabled in Firebase (SETUP.md, step 2)."
      : "Can't connect. Check your internet and try again.";
    $("retryBtn").style.display = "inline-block";
    return;
  }

  await splashDone;
  if (route === "lobby") enterLobby(); else enterRegister();
}
$("retryBtn").onclick = () => location.reload();

// ---------- registration ----------
let checkTimer;
let nameOk = false;

function enterRegister() {
  show("register");
  $("nameInput").focus();
}

$("nameInput").addEventListener("input", () => {
  const v = $("nameInput").value.trim();
  const hint = $("nameHint");
  nameOk = false;
  $("regBtn").disabled = true;
  clearTimeout(checkTimer);
  if (!v) { hint.className = ""; hint.textContent = "3–15 letters, numbers or _"; return; }
  if (!validName(v)) { hint.className = "bad"; hint.textContent = "Use 3–15 letters, numbers or _ only"; return; }
  hint.className = ""; hint.textContent = "Checking…";
  checkTimer = setTimeout(async () => {
    try {
      const snap = await get(ref(db, "names/" + v.toLowerCase()));
      if ($("nameInput").value.trim() !== v) return;
      if (snap.exists() && snap.val() !== uid) {
        hint.className = "bad"; hint.textContent = "“" + v + "” is already taken";
      } else {
        hint.className = "ok"; hint.textContent = "“" + v + "” is available ✓";
        nameOk = true; $("regBtn").disabled = false;
      }
    } catch (e) {
      hint.className = "bad"; hint.textContent = "Couldn't check. Check your connection.";
    }
  }, 400);
});

$("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && nameOk) $("regBtn").click();
});

$("regBtn").onclick = async () => {
  const v = $("nameInput").value.trim();
  if (!nameOk || !validName(v)) return;
  $("regBtn").disabled = true;
  const key = v.toLowerCase();
  try {
    // 1) claim the name (server refuses if somebody else already owns it)
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
    // 2) create the profile
    await set(ref(db, "users/" + uid), { name: v, joined: serverTimestamp() });
    myName = v;
    enterLobby();
  } catch (e) {
    toast("Registration failed. Please try again.");
    $("regBtn").disabled = false;
  }
};

// ---------- lobby ----------
let lobbyUnsub = null;

function enterLobby() {
  show("lobby");
  $("meName").textContent = myName;
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
  if (!ok) { toast("Chatroom1 is full (10/10). Try again later."); return; }
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
    } catch (e) { /* slot taken, try next */ }
  }
  mySlot = null;
  return false;
}

// ---------- chat ----------
function openChat() {
  inRoom = true;
  if (lobbyUnsub) { lobbyUnsub(); lobbyUnsub = null; }
  show("chat");
  $("msgs").innerHTML = "";
  addSystem("You joined Chatroom1");
  history.pushState({ chat: true }, "");

  // members
  unsubs.push(onValue(ref(db, ROOM + "/slots"), async (snap) => {
    const uids = snap.exists() ? Object.values(snap.val()) : [];
    $("memCount").textContent = uids.length + "/" + MAX_MEMBERS;
    $("chatSub").textContent = uids.length + " online";
    const names = await Promise.all(uids.map(getName));
    const ul = $("memList");
    ul.innerHTML = "";
    names.forEach((n, i) => {
      const li = document.createElement("li");
      const av = document.createElement("div"); av.className = "av"; av.textContent = (n || "?")[0].toUpperCase();
      const nm = document.createElement("span"); nm.textContent = n || "…";
      li.append(av, nm);
      if (uids[i] === uid) { const y = document.createElement("span"); y.className = "you"; y.textContent = "you"; li.append(y); }
      ul.append(li);
    });
  }));

  // messages (last 100)
  const q = query(ref(db, ROOM + "/messages"), limitToLast(100));
  unsubs.push(onChildAdded(q, (snap) => addMessage(snap.val())));

  // re-claim slot after a lost connection
  unsubs.push(onValue(ref(db, ".info/connected"), async (s) => {
    if (s.val() === true && inRoom) {
      const ok = await claimSlot();
      if (!ok) { toast("Chatroom1 became full. You were moved out."); leaveChat(true); }
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
  d.className = "sys"; d.textContent = text;
  $("msgs").append(d);
}

function addMessage(m) {
  if (!m || typeof m.text !== "string") return;
  const box = $("msgs");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const mine = m.uid === uid;
  const d = document.createElement("div");
  d.className = "msg " + (mine ? "mine" : "other");
  const who = document.createElement("div"); who.className = "who"; who.textContent = m.name || "?";
  const body = document.createElement("div"); body.textContent = m.text;
  const tm = document.createElement("div"); tm.className = "tm";
  tm.textContent = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
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
    await push(ref(db, ROOM + "/messages"), { uid, name: myName, text, ts: serverTimestamp() });
  } catch (err) {
    toast("Message not sent. Check your connection.");
    $("msgInput").value = text;
  }
  $("msgInput").focus();
});

async function leaveChat(fromPop) {
  if (!inRoom) return;
  inRoom = false;
  unsubs.forEach((u) => { try { u(); } catch (e) {} });
  unsubs = [];
  if (mySlot !== null) {
    const r = ref(db, ROOM + "/slots/" + mySlot);
    try { await onDisconnect(r).cancel(); await remove(r); } catch (e) {}
    mySlot = null;
  }
  $("sheet").classList.remove("open");
  enterLobby();
}

$("backBtn").onclick = () => { if (inRoom) history.back(); };
window.addEventListener("popstate", () => { if (inRoom) leaveChat(true); });

$("membersBtn").onclick = () => $("sheet").classList.add("open");
$("sheet").onclick = (e) => { if (e.target.id === "sheet") $("sheet").classList.remove("open"); };

boot();
