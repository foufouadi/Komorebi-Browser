/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const BINARY_NAME = "notification-helper.exe";

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "log", () =>
  console.createInstance({
    maxLogLevel: "Error",
    maxLogLevelPref: "app.backgroundNotifications.helper.loglevel",
    prefix: "PushNotificationHelper",
  })
);

/**
 * Launches the helper.
 *
 * @param {string[]} args - full argument list for the helper.
 */
function launch(args) {
  const exe = Services.dirsvc.get("GreBinD", Ci.nsIFile);
  exe.append(BINARY_NAME);

  if (!exe.exists()) {
    // TODO: Bug 2067701 packages the helper. Until then its absence is
    // expected, so this must stay below the error level.
    lazy.log.warn(`${BINARY_NAME} is not installed`);
    return;
  }

  const process = Cc["@mozilla.org/process/util;1"].createInstance(
    Ci.nsIProcess
  );

  process.init(exe);
  process.startHidden = true;
  process.noShell = true;
  process.runw(false, args, args.length);
}

/**
 * Windows implementation of the push notification helper. Whether a helper
 * should be running is decided by PushNotificationHelper.sys.mjs; this module
 * only knows how to act on that decision.
 */
export const WindowsPushNotificationHelper = {
  /**
   * Names the profile a helper serves. A helper is per profile, so this is the
   * whole of its identity.
   *
   * @returns {string[]} arguments naming the profile.
   */
  get profileArgs() {
    return ["--profile", Services.dirsvc.get("ProfD", Ci.nsIFile).path];
  },

  /**
   * Starts the push notification helper for the current running profile.
   */
  start() {
    launch(this.profileArgs);
  },

  /**
   * Asks this profile's helper to exit, including one left behind by an
   * earlier Firefox session.
   */
  stop() {
    launch(["--stop", ...this.profileArgs]);
  },
};
