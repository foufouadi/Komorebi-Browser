/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const ENABLED_PREF = "app.backgroundNotifications.helper.enabled";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WindowsPushNotificationHelper:
    "resource://gre/modules/WindowsPushNotificationHelper.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "gImpl", () => {
  // This is currently gated to just windows - but we'd
  // like to expand to other platforms later.
  if (AppConstants.platform == "win") {
    return lazy.WindowsPushNotificationHelper;
  }

  // Stubs for unsupported platforms
  return {
    start() {},
    stop() {},
  };
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  ENABLED_PREF,
  false,
  () => PushNotificationHelper.update()
);

/**
 * Interface to a helper process that delivers push notifications while Firefox
 * is closed, run per profile and outliving the session that started it.
 */
export const PushNotificationHelper = {
  /**
   * Brings the helper in line with the pref. Called once at startup from the
   * browser-idle-startup category, and again whenever the pref changes.
   */
  init() {
    this.update();
  },

  update() {
    if (lazy.enabled) {
      this.start();
    } else {
      this.stop();
    }
  },

  /**
   * Launches the helper detached, so it survives this session.
   */
  start() {
    lazy.gImpl.start();
  },

  /**
   * Asks every helper in this profile's group to exit, including any left
   * behind by an earlier Firefox session. Safe to call when none are running.
   */
  stop() {
    lazy.gImpl.stop();
  },
};
