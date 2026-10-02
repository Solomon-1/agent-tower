# Agent Tower

Elisha's Agent Tower as a home-screen app. Open https://solomon-1.github.io/agent-tower/ and sign in with Google.

- `index.html`, `loader.js`: sign-in and loading.
- `shim.js`: answers the tower's Drive, Gmail and Calendar calls with Google's APIs, using your own sign-in.
- `site.bin`: the tower build, sealed. The key to open it is only in your Google Drive, so this public repo holds no readable personal data.
- `site.json`: which build is current.

The Agent Tower UI thread publishes new builds here. Do not edit `site.bin` by hand.
