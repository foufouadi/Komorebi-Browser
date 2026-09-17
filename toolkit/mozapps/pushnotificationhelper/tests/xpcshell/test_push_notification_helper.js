/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PushNotificationHelper } = ChromeUtils.importESModule(
  "resource://gre/modules/PushNotificationHelper.sys.mjs"
);

const ENABLED_PREF = "app.backgroundNotifications.helper.enabled";

// start() and stop() both launch a real process, so every test stubs them and
// asserts on which one would have run.
function withStubs(task) {
  const original = {
    start: PushNotificationHelper.start,
    stop: PushNotificationHelper.stop,
  };
  const calls = { start: 0, stop: 0 };

  PushNotificationHelper.start = () => calls.start++;
  PushNotificationHelper.stop = () => calls.stop++;

  try {
    return task(calls);
  } finally {
    PushNotificationHelper.start = original.start;
    PushNotificationHelper.stop = original.stop;
  }
}

registerCleanupFunction(() => {
  Services.prefs.clearUserPref(ENABLED_PREF);
});

add_task(async function test_enabled_starts() {
  Services.prefs.setBoolPref(ENABLED_PREF, true);

  withStubs(calls => {
    PushNotificationHelper.update();
    Assert.equal(calls.start, 1, "helper is started when enabled");
    Assert.equal(calls.stop, 0, "nothing is stopped when enabled");
  });
});

add_task(async function test_disabled_stops() {
  Services.prefs.setBoolPref(ENABLED_PREF, false);

  withStubs(calls => {
    PushNotificationHelper.update();
    Assert.equal(calls.stop, 1, "helper is stopped when disabled");
    Assert.equal(calls.start, 0, "nothing is started when disabled");
  });
});

add_task(async function test_flipping_pref_on_starts() {
  Services.prefs.setBoolPref(ENABLED_PREF, false);

  withStubs(calls => {
    Services.prefs.setBoolPref(ENABLED_PREF, true);
    Assert.equal(
      calls.start,
      1,
      "flipping on starts without an explicit update()"
    );
  });
});

add_task(async function test_flipping_pref_off_stops() {
  Services.prefs.setBoolPref(ENABLED_PREF, true);

  withStubs(calls => {
    Services.prefs.setBoolPref(ENABLED_PREF, false);
    Assert.equal(
      calls.stop,
      1,
      "flipping off stops without an explicit update()"
    );
  });
});

// A helper deliberately outlives Firefox, so a session that starts up while the
// pref is disabled must clean up whatever an earlier session left running.
add_task(async function test_startup_while_disabled_stops_orphans() {
  Services.prefs.setBoolPref(ENABLED_PREF, false);

  withStubs(calls => {
    PushNotificationHelper.init();
    Assert.equal(
      calls.stop,
      1,
      "startup stops a helper left by a prior session"
    );
    Assert.equal(calls.start, 0, "startup does not launch one while disabled");
  });
});
