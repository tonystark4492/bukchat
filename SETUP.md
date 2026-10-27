# BUKCHAT: free setup (about 15 minutes, no coding, no credit card)

BUKCHAT needs a small online "server" to pass messages between phones.
We use **Firebase** (Google). Its free plan is enough for a small chatroom.
You only click buttons, there is nothing to program.

---

## Step 1: Create the free Firebase project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project**, name it `bukchat`, and click Continue.
3. Turn **Google Analytics OFF** (not needed), then click **Create project**.

## Step 2: Turn on login (anonymous)
1. In the left menu: **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab, choose **Anonymous**, switch it **Enable**, and click Save.

## Step 3: Create the database and paste the rules
1. Left menu: **Build → Realtime Database → Create Database**.
2. Choose any location and select **Start in locked mode**, then Enable.
3. Open the **Rules** tab. Delete everything there, paste the full content of
   `database.rules.json` (from this folder), and click **Publish**.
   These rules are what guarantee **unique names** and the **10-member limit**.

## Step 4: Copy your Firebase details into the app
1. Click the gear icon (top left) → **Project settings**.
2. Scroll to **Your apps** → click the **Web** icon `</>` → name it `bukchat` → Register app.
   (Skip "Firebase Hosting" if it asks.)
3. You will see a block of code named `firebaseConfig`. Copy these values into
   `config.js`: `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`.
   Keep the quote marks. If `databaseURL` is missing, copy the URL shown at the top
   of the Realtime Database page (it looks like `https://bukchat-xxxx-default-rtdb.firebaseio.com`).

## Step 5: Put the app online (free)
Pick ONE option.

**Option A: Firebase Hosting (easiest, same account)**
1. On a computer, install Node.js from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   npm install -g firebase-tools
   firebase login
   firebase init hosting     (choose your bukchat project, public folder = . , single-page app = No)
   firebase deploy
   ```
3. You get a link like `https://bukchat-xxxx.web.app`.

**Option B: GitHub Pages (no terminal)**
1. Make a free account at https://github.com, create a new **public** repository.
2. Upload all files from this folder (Add file → Upload files).
3. Settings → Pages → Branch: `main` → Save. Your link appears after a minute.

## Step 6: Install on Android
**Quick way:** open your link in Chrome on the phone, tap ⋮ → **Install app** (or Add to Home screen).
It then opens full screen like a normal app, with the BUKCHAT icon.

**Real APK file (free):**
1. Go to https://www.pwabuilder.com and paste your link.
2. Click Package for stores → **Android** → generate. Download the `.apk`/`.aab`.
3. Send the APK to friends and open it on their phone (allow "install unknown apps" when asked).

---

## How the rules work
- **Unique names:** a name is stored once on the server, and the server refuses a second claim.
- **10 members:** the room has 10 seats. Joining takes a seat; leaving or closing the app frees it
  automatically. The 11th person sees "Chatroom1 is full".
- Names are not case sensitive (`Raj` and `raj` count as the same).

## Good to know
- Your account lives on your phone. If you clear the app's data or reinstall, you get a new
  account and must pick a new name (the old name stays reserved).
- Chats are visible to anyone with the app, so don't share passwords or private info.
- To add Chatroom2 later, duplicate the `chatroom1` part of the rules and the code.
- Free plan limits are generous (1 GB storage, 100 simultaneous connections), far above
  what a 10-person room needs.
