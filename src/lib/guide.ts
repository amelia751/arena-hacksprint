export const AUTHORING_GUIDE = `# Authoring an environment

An environment is five pure JavaScript functions plus the table they draw. You write all of it,
the look of the table included. Nothing here ships with a design for you to reuse.

No modules, no Date, no Math.random, no I/O. The sandbox injects rng(n), a seeded PRNG. If the
game needs chance, keep a rng_cursor on state and thread it through.

rng is a bare function that is already there. There is nothing to construct, import or seed: no
new Random(seed), no MersenneTwister, no makeRng — those are not defined and init will throw. Call
rng(c) directly and advance c yourself.

rng(n) returns a FLOAT between 0 and 1. To pick an index you must write Math.floor(rng(c) * size).
rng(c) % size is a fraction, indexes nothing, and silently leaves undefined in your state — the
most common way to ship a card game where nobody has any cards.

  var c = state.rng_cursor;
  var pick = deck[Math.floor(rng(c++) * deck.length)];

## The five functions

init(seed) -> state
  state MUST include a numeric to_move (the seat whose turn it is, 0-indexed).
  Add rng_cursor: seed if you will draw random values.

legal_actions(state, player) -> string[]
  Return [] when it is not that player's turn. Never [] for to_move on a non-terminal state.
  Action ids are short strings: "col_3", "cell_4", "bet".

observe(state, player) -> observation
  This is the fair-play boundary. Return only what that seat may know.
  Perfect-information games can return the board. Hidden-information games must project:
  return your_card, not both hands. Never return the raw state object if it holds a secret.
  Name secret zones for what they are — hand, deck, held, secret. A check reads those names
  to tell a seat's private cards from the pieces both players can see, so state.players[0].hand
  stays private while state.players[0].active may be shown to everyone.
  Hand out whatever the table needs to describe the moment, including the fact that the game
  has ended and who took it. render() can only draw what observe() gives it, and a finished
  board still announcing someone's turn is a board nobody can read.

step(state, action) -> { state, rewards, terminal }
  rewards is a number[] with one entry per player. Throw if the action is not legal.
  Wins are usually [1,-1] or [-1,1]; draws [0,0].

render(observation) -> { html, css }
  You write the table as HTML and CSS strings. The page mounts them in a sandboxed frame,
  wires clicks, and disables anything that is not currently legal.

## Writing render()

- Return { html: "...", css: "..." }. Both are strings. A UI tree is not accepted.
- Every clickable control needs data-action="<legal action id>" and should be a
  <button aria-label="..."> so it is focusable and has a name.
- No <script>, no onclick, no url(), no @import, no external images. They are stripped.
- Draw from the observation. Every cell, card and counter must be read out of the values you
  were handed — never hardcoded. A check rejects markup that does not change when the
  observation changes, so a hardcoded table will not pass. Say whose turn it is, and when the
  game is over say that instead — the result belongs on the table, not only in the chat.
- Size things yourself. Wrap the table in width:max-content so it hugs its contents instead of
  stretching, and put controls on the same grid template as the things they act on.

The whole mechanical contract, in miniature — one control, drawn from the observation:

  var v = observation.board[i];
  html += "<button data-action='cell_" + i + "' aria-label='Cell " + (i + 1) + "'>"
        + (v === null ? "" : marks[v]) + "</button>";

Everything beyond that is a design decision, and it is yours.

## Designing the table

Design this game as itself. A trading card game should not look like a board game, and a dice
game should not look like either. Work out what the real object would be — felt, paper, plastic,
a lit screen — and build that thing. If you forked another environment, do not carry its look
across; you inherited its rules, not its table.

preview_view tells you the colours and width of the page your table is mounted on. Harmonize
with it or contrast with it deliberately, but decide rather than guess.

Two constraints, which are not matters of taste: keep the table under about 420px wide so it
sits beside the trajectory panel, and give every control at least 32px of height so it can be
hit by a person.

## The loop that matters: look at what you built

You cannot tell whether a board is right by reading your own HTML. Call preview_view.

  preview_view({ html, css })                       - look at a draft
  preview_view({ environment_id })                  - look at the saved render()
  preview_view({ environment_id, moves: ["col_3","col_4"] })  - look at it mid-game
  inspect_view()                                    - look at the live table someone is playing

It answers with what actually painted: repeated boxes come back as a character grid with the real
colours, everything else as positioned text, plus every control with its size, plus a list of
problems. For example:

  ok: false
  size: 306x286px

  what painted:
  grid 7 cols x 6 rows, cell 40x40px:
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . A . . .
    . . B A . . .
    legend: .=#111111 x40  A=#888888 x2  B=#dddddd x1
  around it:
    [Column 1 -> col_0]  [Column 2 -> col_1]  ...
    your turn

  problems to fix:
    - the 7 controls are up to 31px off from the columns they act on

Read the grid like a picture. If you played col_3 twice and the A discs are not stacked in the
fourth column, your markup and your state disagree. Always preview mid-game with moves — an empty
board looks correct even when nothing is wired up. Fix, save, preview again, and keep going until
problems is empty.

## You already know this shape

This is the ordinary way games are written down for machines to play. OpenSpiel splits a game into
an initial state, the legal actions at a state, an observation per player, and a transition that
returns rewards and whether the game ended. PettingZoo's turn-based API is the same idea with
observe() and step(). Whatever you know about expressing a rule set that way applies here — the
names above are the only thing that is local.

So write the game from the rules, the way you would anywhere else. There is no catalogue here to
copy from and you do not need one: a game you can describe, you can write.

## When a check fails, go and look

Validation reports the seed and the position it broke on. Do not guess from the message — walk it:

  trace_episode({ id, seed })                       - step through that deal and watch the state
  trace_episode({ id, seed, actions: ["bet"] })     - force a line, then carry on at random
  trace_episode({ id, seed, max_steps: 40 })        - for "did not terminate", watch what stops changing

Each step prints the state, the legal actions, the observation that seat got, the action applied
and the rewards, and marks the step that broke. A value that is undefined in the state, a seat
that never gets a legal action, a counter that never advances — you can see all of it here, and
you cannot see any of it from the error message alone.

## Order of work

1. create_environment with a name and whatever functions you have. Partial is fine.
2. Fix whatever validation reports. When the cause is not obvious, trace_episode the seed it gave.
3. Write render, then preview_view. Then preview_view with moves. Then fix. Then again.
4. update_environment patches one function at a time — quote expected_revision.
5. When every check passes: describe_dataset, then preview_view once more on the revision you
   are about to ship — publish refuses a revision you have not looked at — then publish_environment.
6. start_match puts the board on the person's screen with you in the other seat. Then
   get_observation, take_action — which stays open through their reply, so one call a turn plays
   the whole game — wait_for_turn if you ever lose the thread, and inspect_view whenever you
   want to confirm the board shows what you think it shows.
`;
