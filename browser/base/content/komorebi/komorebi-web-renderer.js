(function (global) {
  "use strict";

  class WebRenderer {
    get supported() {
      return false;
    }
  }

  global.KomorebiWebRenderer = WebRenderer;
})(this);
