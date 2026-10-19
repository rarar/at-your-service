// At Your Service — Wi-Fi bell driver
// Arduino Uno R4 WiFi + Adafruit I2C 8-Channel Solenoid Driver (MCP23017), channels 0-5
// Holds a websocket open to the server; each '0'..'5' it receives strikes that bell once.
// The agents only work while this board is connected.
//
// Copy arduino_secrets.example.h to arduino_secrets.h and fill it in.
// Libraries: Adafruit MCP23017 Arduino Library, ArduinoHttpClient.

#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <Adafruit_MCP23X17.h>
#include "arduino_secrets.h"

const unsigned long STRIKE_MS    = 40;     // same value you tuned in the sweep test
const unsigned long HEARTBEAT_MS = 10000;  // server drops the board after 30s of silence

Adafruit_MCP23X17 mcp;
WiFiSSLClient tls;
WebSocketClient ws(tls, SERVER_HOST, 443);
unsigned long lastBeat = 0;

void strike(int i) {
  mcp.digitalWrite(i, HIGH);
  delay(STRIKE_MS);
  mcp.digitalWrite(i, LOW);
}

void connect() {
  digitalWrite(LED_BUILTIN, LOW);
  while (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    delay(5000);
  }
  // a sleeping Render server can take a minute to wake; keep trying
  while (ws.begin(String("/bells?key=") + BELL_KEY) != 0) delay(5000);
  digitalWrite(LED_BUILTIN, HIGH);  // on = connected, the agents are working
  lastBeat = millis();
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  if (!mcp.begin_I2C()) { while (1); }
  for (int i = 0; i < 6; i++) {
    mcp.pinMode(i, OUTPUT);
    mcp.digitalWrite(i, LOW);
  }
  connect();
}

void loop() {
  if (!ws.connected()) { ws.stop(); connect(); }

  if (ws.parseMessage() > 0) {
    while (ws.available()) {
      int c = ws.read();
      if (c >= '0' && c <= '5') strike(c - '0');
    }
  }

  if (millis() - lastBeat > HEARTBEAT_MS) {
    ws.beginMessage(TYPE_TEXT);
    ws.print("h");
    ws.endMessage();
    lastBeat = millis();
  }
}
