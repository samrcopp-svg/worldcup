# 🏆 Family World Cup 2026 Sweepstake

A tiny web app that shows a live leaderboard for your family World Cup sweepstake.
Each player owns 8 teams; teams earn points for every knockout round they reach.

## What's inside
- **Leaderboard tab** – players ranked by total points (group + knockout columns).
- **Breakdown** – every player's 8 teams, their W/D/L record, round reached and points.
- **Matches tab** – every fixture in **New Zealand time**, with live scores and the family member shown under each team. Updates automatically every minute.
- **Live data** – pulled free from TheSportsDB (FIFA World Cup). No paid APIs.
- **Backend** – Node + Express. Scores are computed live from the data feed; an optional `data.json` only stores manual knockout overrides.

## Scoring
**Group stage** — each match: **win = 3, draw = 1, loss = 0** (added up across all 3 group games).

**Knockout** — a bonus that stacks for every round a team reaches:

| Reaches          | Bonus |
|------------------|-------|
| Round of 32 (out of group) | +3 |
| Round of 16      | +4 |
| Quarter-final    | +5 |
| Semi-final       | +6 |
| Final            | +7 |
| Champion         | +8 |

A team's total = its group match points **plus** its knockout bonus. Everything is
worked out automatically from live results — the leaderboard always reflects the latest scores.

## Run it on your own computer
```bash
cd worldcup
npm install
npm start
```
Then open http://localhost:3000

To update results, open http://localhost:3000/admin.html, type the admin key
(default `changeme`), and pick each team's furthest round from the dropdowns.

---

## Deploy it free (so the family can use it) — step by step

We'll use **Render.com** (free tier, no credit card needed). This is the easiest
way to put your first app online.

### 1. Put the code on GitHub
1. Create a free account at https://github.com
2. Click **New repository**, name it `worldcup`, keep it Public, click **Create**.
3. On your computer, inside the `worldcup` folder, run:
   ```bash
   git init
   git add .
   git commit -m "World Cup sweepstake"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/worldcup.git
   git push -u origin main
   ```
   (Replace `YOUR-USERNAME` with your GitHub username.)

### 2. Deploy on Render
1. Sign up at https://render.com (you can log in with GitHub).
2. Click **New +** → **Web Service**.
3. Connect your GitHub and pick the `worldcup` repo.
4. Fill in:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Under **Environment**, add a variable:
   - Key: `ADMIN_KEY`  Value: *a secret word only you know* (replaces `changeme`)
6. Click **Create Web Service**.

After a minute or two Render gives you a URL like
`https://worldcup-xxxx.onrender.com`. Share that link with the family!
The admin page is at `…onrender.com/admin.html`.

> **Heads-up on the free tier:** the app "sleeps" after 15 minutes of no visitors,
> so the first visit after a quiet spell takes ~30 seconds to wake up — totally
> fine for a family of six. Also, `data.json` resets if Render rebuilds the app,
> so it's worth re-entering any results after a redeploy (you'll rarely redeploy).

### Alternatives (also free)
- **Railway** (railway.app) and **Fly.io** (fly.io) work the same way — connect
  the GitHub repo, set the start command to `npm start`, set the `ADMIN_KEY`.

---

## Keeping scores up to date
Scores update **by themselves** — the server re-checks the free TheSportsDB feed
every minute and the page refreshes every minute, so the family always sees current
results. Group-stage points and the matches list are fully automatic.

For the knockout rounds, the app guesses each team's round from the feed. When the
knockouts begin, glance at the leaderboard and, if a team's round looks wrong, open
`/admin.html` and set it manually (this overrides the auto-detect). You'll rarely need to.

## Editing the teams/players
Open `server.js` and edit the `SEED` object near the top, then delete `data.json`
and restart so it rebuilds from your changes.
