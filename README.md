# At Your Service

Six agents build a to-do app, ship it, and start over. Forever.
Every line an agent says strikes its call bell.
The agents only work while the bells are connected, so nothing runs (or costs) while the piece is off.

## Files

- `server.js` — runs the agents, serves the display, rings the bells
- `index.html` — the display: terminal on the left, to-do app on the right
- `bells/bells.ino` — Arduino Uno R4 WiFi sketch for the Adafruit I2C 8-Channel Solenoid Driver
- `bells/arduino_secrets.example.h` — Wi-Fi and server settings for the sketch
- `preview.html` — the display with a scripted sprint, no agents, for checking the look
- `render.yaml` — Render setup
- `package.json`

## Run on Render

1. In Render: **New > Blueprint**, pick this repo. When asked, paste an Anthropic
   API key into `ANTHROPIC_API_KEY`. `BELL_KEY` is generated for you.
2. When it's live, note the URL (like `at-your-service.onrender.com`) and copy
   `BELL_KEY` from the service's **Environment** page.
3. Set up the Arduino (below) with that URL and key.
4. Open the URL fullscreen on whatever screen shows the piece.

The free plan sleeps when nothing is connected; when the board comes on it wakes
the server, which takes about a minute. The agents start once the board connects
(its built-in LED turns on) and stop when it goes offline.

## Arduino

1. Wiring: 5V→VIN, GND→GND, SDA→SDA, SCL→SCL; 12V into the center terminals;
   solenoids on channels 0–5.
2. In the Arduino IDE, install the **Adafruit MCP23017 Arduino Library** and
   **ArduinoHttpClient** libraries.
3. Copy `bells/arduino_secrets.example.h` to `bells/arduino_secrets.h` and fill in
   your Wi-Fi, the Render URL and `BELL_KEY`. (`arduino_secrets.h` stays out of git.)
4. Open `bells/bells.ino` and upload it to the Uno R4 WiFi.

## Run locally

    npm install
    BELL_KEY=some-secret node server.js

Open http://localhost:3000. The board only talks to the Render server (it needs
https), so locally use `RUN=always` to run the agents with no bells connected. With
no API key, the agents run through Claude Code (`claude -p`) on your subscription;
with `ANTHROPIC_API_KEY` set they call the API directly.

## Knobs

In `server.js`: `PAUSE_MS` (rest between agents), `LINE_MS` (gap between lines and bell strikes), `MODEL` (Haiku, the cheapest), `EFFORT`.
In `bells/bells.ino`: `STRIKE_MS` (pulse length).
Ring a bell by hand: `/ring/3?key=<BELL_KEY>`
