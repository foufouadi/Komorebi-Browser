/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

(function (global) {
  "use strict";

  class WebRenderer {
    get supported() {
      return false;
    }
  }

  global.KomorebiWebRenderer = WebRenderer;
})(this);
