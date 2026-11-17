# Boat control contract (Dynamic mode)

How the website and the boat's ESP32 talk. No Blynk, no extra server: both sides use the same Firebase Realtime Database.
All paths are under `hydrasense_v2/boats/{DEVICE_ID}/`. The device must be ticked "boat" on the admin page.

## Nodes

| Node | Written by | Content |
|---|---|---|
| `cmd` | the allowed driver (or admin) | `{ l, r, arm, estop, seq, by, t, m? }` |
| `status` | the boat (its own device login) | `{ seen, armed, estop, l, r, seq, batt, rssi, lat, lon }` |
| `driver` | admin only | `{ uid, name, since }` : the one person allowed to drive |
| `requests/{uid}` | a signed-in visitor | `{ name, email, t }` : "please let me drive" |

`cmd` fields: `l`, `r` = left / right motor in percent, -100..100 (negative = reverse). `arm` = motors may run.
`estop` = emergency stop. `seq` = counter that changes on every command. `by` = uid of the sender.
`t` = server time. `m` = changes when the driver presses "Stop and measure here".

`status` fields: `seen` = server timestamp (write `{".sv":"timestamp"}`), about once a second. `l`, `r` = what the motors
are REALLY doing now. `seq` = the last `cmd.seq` the boat acted on (the website uses this as confirmation).

## What the website does

- Sends `cmd` every 250 ms only while a button, key or the joystick is held. On release it sends `l=0, r=0` three times.
- While armed and idle it sends a zero command once a second (heartbeat).
- Emergency Stop sends `{ l:0, r:0, arm:false, estop:true }`.
- It never assumes the boat moved: it shows `status.l / status.r` and whether `status.seq` caught up.

## What the firmware MUST do (safety)

1. Boot with both motors off and disarmed. IN1-IN4 and ENA/ENB low before Wi-Fi starts.
2. Run motors only if `arm == true`, `estop == false` and the command is fresh.
3. **Command timeout:** no new `seq` for 1.5 s -> both motors off. No command at all for 10 s -> disarm.
4. `estop == true` -> motors off and latched. Leave the latch only on a later command with `arm == true` and `estop == false`.
5. Physical emergency stop: a switch in the motor battery line (works even if the ESP32 hangs) plus, optionally, a button
   on a GPIO that sets the same latch and reports `status.estop = true`.
6. Wi-Fi or Firebase connection lost -> motors off immediately.
7. Changing direction: go through zero and wait about 200 ms; ramp speed instead of jumping.
8. "Stop and measure": when `m` changes, stop the motors, wait for the water to settle, then take a normal measurement
   and post it with `"mode": "dynamic"`. Never read the analog sensors while the motors run (electrical noise).

## Wiring given by the team (L298N)

| L298N | ESP32 |
|---|---|
| ENA (PWM, motor 1 / left) | GPIO 25 |
| IN1 | GPIO 26 |
| IN2 | GPIO 27 |
| ENB (PWM, motor 2 / right) | GPIO 32 |
| IN3 | GPIO 18 |
| IN4 | GPIO 19 |
| GND | GND (common with the motor battery) |

Remove the ENA and ENB jumpers, otherwise speed control does nothing. PWM duty = `abs(percent) x 255 / 100`
(25 % = 64, 50 % = 128, 75 % = 191, 100 % = 255). Still to decide on the bench: the lowest duty at which the motors
actually turn, and a maximum-duty cap if the motors are rated below the battery voltage (for example 6 V motors on an
11.1 V pack). Add pull-down resistors (about 10 k) on ENA/ENB so a resetting ESP32 cannot leave a motor running.

## REST access from the ESP32

Sign in exactly as for measurements (see DEVICE_CONTRACT.md), then:

- read commands: `GET {DB_URL}/hydrasense_v2/boats/{ID}/cmd.json?auth={idToken}` with header `Accept: text/event-stream`
  (streaming, one connection stays open), or poll the same URL 4-5 times a second.
- write status: `PUT {DB_URL}/hydrasense_v2/boats/{ID}/status.json?auth={idToken}`.

Wi-Fi range is the limit: tens of metres from the hotspot in the open. This design is for ponds and pit lakes near the
bank, not for open sea.

The firmware is not part of this website package. It has to be written against this contract and tested on the bench
with the propellers out of the water first.
