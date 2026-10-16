// Games the checks play against. The page ships with none of its own, so a test
// that needs a board has to write one first — same path an agent takes.
import { readFile, writeFile } from "node:fs/promises";

export const TICTACTOE = {
  name: "Tic-Tac-Toe",
  description: "3×3 perfect-information game.",
  players: 2,
  code: {
    init: `function init(seed) {
  return { board: [null, null, null, null, null, null, null, null, null], to_move: 0, rng_cursor: seed };
}`,
    legal_actions: `function legal_actions(state, player) {
  if (player !== state.to_move) return [];
  var out = [];
  for (var i = 0; i < 9; i++) if (state.board[i] === null) out.push("cell_" + i);
  return out;
}`,
    observe: `function observe(state, player) {
  return { board: state.board, to_move: state.to_move, you_are: player };
}`,
    step: `function step(state, action) {
  if (typeof action !== "string" || action.indexOf("cell_") !== 0) throw new Error("illegal action");
  var i = parseInt(action.slice(5), 10);
  if (state.board[i] !== null) throw new Error("illegal: cell taken");
  var board = state.board.slice();
  board[i] = state.to_move;
  var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  var won = false;
  for (var L = 0; L < lines.length; L++) {
    var a = lines[L][0], b = lines[L][1], c = lines[L][2];
    if (board[a] === state.to_move && board[b] === state.to_move && board[c] === state.to_move) won = true;
  }
  var full = true;
  for (var k = 0; k < 9; k++) if (board[k] === null) full = false;
  var next = { board: board, to_move: 1 - state.to_move, rng_cursor: state.rng_cursor };
  if (won) return { state: next, rewards: state.to_move === 0 ? [1, -1] : [-1, 1], terminal: true };
  if (full) return { state: next, rewards: [0, 0], terminal: true };
  return { state: next, rewards: [0, 0], terminal: false };
}`,
    render: `function render(observation) {
  var html = "<div class='ttt'><div class='board'>";
  for (var i = 0; i < 9; i++) {
    var v = observation.board[i];
    var mark = v === 0 ? "X" : v === 1 ? "O" : "";
    var cls = v === 0 ? "x" : v === 1 ? "o" : "empty";
    html += "<button class='cell " + cls + "' data-action='cell_" + i + "' aria-label='Cell " + (i + 1) + "'>" + mark + "</button>";
  }
  html += "</div><p class='who'>" + (observation.to_move === observation.you_are ? "your turn" : "waiting") + "</p></div>";
  var css = ".ttt{display:flex;flex-direction:column;align-items:center;gap:12px}.board{display:grid;grid-template-columns:repeat(3,54px)}.cell{width:54px;height:54px;border:0;border-right:2.5px solid #1c1814;border-bottom:2.5px solid #1c1814;background:#faf6ee;font:28px Georgia,serif;color:#1c1814}.cell:nth-child(3n){border-right:0}.cell:nth-child(n+7){border-bottom:0}.cell.o{color:#b33a1a}.who{margin:0;color:#6e675c;font-size:14px}";
  return { html: html, css: css };
}`,
  },
};

export const CONNECT_FOUR = {
  name: "Connect Four",
  description: "6×7 grid. Drop a disc; first to four in a row wins.",
  players: 2,
  code: {
    init: `function init(seed) {
  var board = [];
  for (var r = 0; r < 6; r++) { var row = []; for (var c = 0; c < 7; c++) row.push(null); board.push(row); }
  return { board: board, to_move: 0, winner: null, rng_cursor: seed };
}`,
    legal_actions: `function legal_actions(state, player) {
  if (player !== state.to_move) return [];
  var out = [];
  for (var c = 0; c < 7; c++) if (state.board[0][c] === null) out.push("col_" + c);
  return out;
}`,
    observe: `function observe(state, player) {
  return { board: state.board, to_move: state.to_move, winner: state.winner, you_are: player };
}`,
    step: `function step(state, action) {
  if (typeof action !== "string" || action.indexOf("col_") !== 0) throw new Error("illegal action");
  var c = parseInt(action.slice(4), 10);
  if (!(c >= 0 && c < 7)) throw new Error("illegal column");
  var b = [];
  for (var r = 0; r < 6; r++) b.push(state.board[r].slice());
  var row = -1;
  for (var i = 5; i >= 0; i--) if (b[i][c] === null) { row = i; break; }
  if (row === -1) throw new Error("illegal: column full");
  b[row][c] = state.to_move;
  function win(rr, cc, dr, dc) {
    var n = 0;
    for (var k = -3; k <= 3; k++) {
      var y = rr + k * dr, x = cc + k * dc;
      if (y >= 0 && y < 6 && x >= 0 && x < 7 && b[y][x] === state.to_move) { n++; if (n === 4) return true; }
      else n = 0;
    }
    return false;
  }
  var won = win(row, c, 0, 1) || win(row, c, 1, 0) || win(row, c, 1, 1) || win(row, c, 1, -1);
  var full = true;
  for (var x = 0; x < 7; x++) if (b[0][x] === null) full = false;
  var next = { board: b, to_move: 1 - state.to_move, winner: null, rng_cursor: state.rng_cursor };
  if (won) {
    next.winner = state.to_move;
    return { state: next, rewards: state.to_move === 0 ? [1, -1] : [-1, 1], terminal: true };
  }
  if (full) {
    next.winner = "draw";
    return { state: next, rewards: [0, 0], terminal: true };
  }
  return { state: next, rewards: [0, 0], terminal: false };
}`,
    render: `function render(observation) {
  var html = "<div class='c4'><div class='drops'>";
  for (var c = 0; c < 7; c++) html += "<button class='drop' data-action='col_" + c + "' aria-label='Column " + (c + 1) + "'></button>";
  html += "</div><div class='board'>";
  for (var r = 0; r < 6; r++) {
    for (var c = 0; c < 7; c++) {
      var v = observation.board[r][c];
      var mark = v === 0 ? "x" : v === 1 ? "o" : "";
      html += "<span class='cell " + mark + "'></span>";
    }
  }
  var w = observation.winner;
  var said = w === null || w === undefined
    ? (observation.to_move === observation.you_are ? "your turn" : "waiting")
    : w === "draw" ? "a draw"
    : w === observation.you_are ? "you win" : "you lose";
  html += "</div><p class='who'>" + said + "</p></div>";
  var css = ".c4{display:flex;flex-direction:column;align-items:center;gap:6px;width:max-content}.drops,.board{display:grid;grid-template-columns:repeat(7,40px);gap:5px}.drops{padding:0 14px}.drop{height:36px;border:0;background:transparent;position:relative}.drop:not(:disabled):after{content:'';position:absolute;left:50%;top:13px;transform:translateX(-50%);border:5px solid transparent;border-top-color:#1c1814}.board{padding:14px;background:#1b4a38;border-radius:18px}.cell{width:40px;height:40px;border-radius:50%;background:#14392c;box-shadow:inset 0 2px 4px rgba(0,0,0,.35)}.cell.x{background:radial-gradient(circle at 32% 28%,#f3d37a,#d4a24a 62%,#a87a20);box-shadow:none}.cell.o{background:radial-gradient(circle at 32% 28%,#fffaf0,#efe6d4 60%,#c9bea6);box-shadow:none}.who{margin:2px 0 0;color:#6e675c;font-size:14px}";
  return { html: html, css: css };
}`,
  },
};

export const KUHN = {
  name: "Kuhn Poker",
  description: "3-card poker. Each player sees only their own card.",
  players: 2,
  code: {
    init: `function init(seed) {
  var deck = [0, 1, 2];
  var cursor = seed;
  for (var i = 2; i > 0; i--) {
    var j = Math.floor(rng(cursor++) * (i + 1));
    var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return { hands: [deck[0], deck[1]], burned: deck[2], pot: 2, bets: [1, 1], history: [], to_move: 0, rng_cursor: cursor };
}`,
    legal_actions: `function legal_actions(state, player) {
  if (player !== state.to_move) return [];
  var h = state.history;
  if (h.length && h[h.length - 1] === "bet") return ["fold", "call"];
  return ["check", "bet"];
}`,
    observe: `function observe(state, player) {
  return {
    your_card: state.hands[player],
    pot: state.pot,
    history: state.history.slice(),
    you_are: player,
    to_move: state.to_move
  };
}`,
    step: `function step(state, action) {
  var legal = (function () {
    var h = state.history;
    if (h.length && h[h.length - 1] === "bet") return ["fold", "call"];
    return ["check", "bet"];
  })();
  var ok = false;
  for (var i = 0; i < legal.length; i++) if (legal[i] === action) ok = true;
  if (!ok) throw new Error("illegal action");
  var h = state.history.concat([action]);
  var me = state.to_move;
  var bets = state.bets.slice();
  var pot = state.pot;
  if (action === "bet" || action === "call") { bets[me] += 1; pot += 1; }
  var next = { hands: state.hands, burned: state.burned, pot: pot, bets: bets, history: h, to_move: 1 - me, rng_cursor: state.rng_cursor };
  if (action === "fold") {
    return { state: next, rewards: me === 0 ? [-bets[0], bets[0]] : [bets[1], -bets[1]], terminal: true };
  }
  var last2 = h.length >= 2 ? h[h.length - 2] + "," + h[h.length - 1] : "";
  if (last2 === "check,check" || last2 === "bet,call") {
    var w = state.hands[0] > state.hands[1] ? 0 : 1;
    var amt = Math.min(bets[0], bets[1]);
    return { state: next, rewards: w === 0 ? [amt, -amt] : [-amt, amt], terminal: true };
  }
  return { state: next, rewards: [0, 0], terminal: false };
}`,
    render: `function render(observation) {
  var ranks = ["J", "Q", "K"];
  var card = ranks[observation.your_card] || String(observation.your_card);
  var hist = (observation.history || []).join(" · ");
  var html = "<div class='kp'><div class='card'>" + card + "</div><p class='pot'>pot " + observation.pot + "</p>";
  if (hist) html += "<p class='log'>" + hist + "</p>";
  html += "<p class='badge'>" + (observation.to_move === observation.you_are ? "your turn" : "waiting") + "</p>";
  html += "<div class='moves'><button data-action='check'>check</button><button data-action='bet'>bet</button><button data-action='call'>call</button><button data-action='fold'>fold</button></div></div>";
  var css = ".kp{display:flex;flex-direction:column;align-items:center;gap:10px}.card{width:50px;height:70px;border-radius:6px;background:#fbf7ef;box-shadow:0 8px 18px rgba(28,24,20,.14);display:flex;align-items:flex-start;padding:6px 8px;font:22px Georgia,serif}.pot,.log,.badge{margin:0;color:#6e675c;font-size:14px}.moves{display:flex;gap:8px}.moves button{background:#1c1814;color:#f4efe6;border:0;border-radius:999px;padding:6px 14px;font-size:14px}.moves button:disabled{opacity:.3}";
  return { html: html, css: css };
}`,
  },
};

/** Writes a fixture through the same API an agent uses, and hands back its id. */
export async function seed(base, fixture) {
  const res = await fetch(`${base}/api/environments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fixture),
  });
  const body = await res.json();
  const id = body.environment?.id;
  if (!id) throw new Error(`could not seed ${fixture.name}: ${JSON.stringify(body).slice(0, 300)}`);
  return id;
}

/** Takes seeded fixtures back out of a local store so runs do not pile up. */
export async function forget(ids) {
  const store = new URL("../.data/store.json", import.meta.url);
  try {
    const db = JSON.parse(await readFile(store, "utf8"));
    const gone = new Set(ids);
    for (const id of gone) delete db.environments?.[id];
    for (const [mid, match] of Object.entries(db.matches ?? {})) {
      if (!gone.has(match.environment_id)) continue;
      delete db.matches[mid];
      delete db.steps?.[mid];
    }
    await writeFile(store, JSON.stringify(db, null, 2));
  } catch {
    // A remote target has no file to tidy.
  }
}
