// At Your Service — serial bell driver
// Adafruit I2C 8-Channel Solenoid Driver (MCP23017), channels 0-5
// Host sends a single char '0'..'5'; that bell strikes once.

#include <Adafruit_MCP23X17.h>

Adafruit_MCP23X17 mcp;

const unsigned long STRIKE_MS = 40;   // same value you tuned in the sweep test

void setup() {
  Serial.begin(115200);
  if (!mcp.begin_I2C()) { while (1); }
  for (int i = 0; i < 6; i++) {
    mcp.pinMode(i, OUTPUT);
    mcp.digitalWrite(i, LOW);
  }
}

void loop() {
  if (Serial.available()) {
    int c = Serial.read();
    if (c >= '0' && c <= '5') {
      int i = c - '0';
      mcp.digitalWrite(i, HIGH);
      delay(STRIKE_MS);
      mcp.digitalWrite(i, LOW);
    }
  }
}
