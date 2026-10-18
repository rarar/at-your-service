# At Your Service

Six agents build a to-do app, ship it, and start over. Forever.
Each finished turn rings a call bell.

## Files

- `server.js` — runs the agents, serves the display, rings the bells
- `index.html` — the display: terminal on the left, to-do app on the right
- `bells.ino` — Arduino sketch for the Adafruit I2C 8-Channel Solenoid Driver
- `preview.html` — the display with a scripted sprint, no agents, for checking the look
- `package.json`

## Run

1. Flash `bells.ino` to the Arduino. Wiring: 5V→VIN, GND→GND, A4→SDA, A5→SCL;
   12V into the center terminals; solenoids on channels 0–5.
2. `npm install`
3. `node server.js`
4. Open http://localhost:3000 fullscreen.

Agents run through Claude Code (`claude -p`) on your subscription.
To use a separate account for the piece:

    CLAUDE_CONFIG_DIR=~/.claude-bells claude auth login
    CLAUDE_CONFIG_DIR=~/.claude-bells node server.js

Or with an API key: `BACKEND=api ANTHROPIC_API_KEY=sk-... node server.js`

## Knobs

In `server.js`: `PAUSE_MS` (rest between turns), `MODEL`.
In `bells.ino`: `STRIKE_MS` (pulse length).
Ring a bell by hand: http://localhost:3000/ring/3
