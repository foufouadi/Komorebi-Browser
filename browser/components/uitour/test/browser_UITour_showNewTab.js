"use strict";

var gTestTab;
var gContentAPI;

add_task(setup_UITourTest);

// Test that we can switch to about:newtab
add_UITour_task(async function test_aboutNewTab() {
  let newTabLoaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    "about:newtab"
  );
  info("Showing about:newtab");
  await gContentAPI.showNewTab();
  info("Waiting for about:newtab to load");
  await newTabLoaded;
  is(
    gBrowser.selectedBrowser.currentURI.spec,
    "about:newtab",
    "Loaded about:newtab"
  );
  ok(gURLBar.focused, "Address bar gets focus");
});

// Test that a valid hash is appended to the loaded URL
add_UITour_task(async function test_aboutNewTab_withHash() {
  let newTabLoaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    "about:newtab#customize"
  );
  info("Showing about:newtab#customize");
  await gContentAPI.showNewTab("customize");
  info("Waiting for about:newtab#customize to load");
  await newTabLoaded;
  is(
    gBrowser.selectedBrowser.currentURI.spec,
    "about:newtab#customize",
    "Loaded about:newtab#customize"
  );
});

// Test that an invalid hash is ignored
add_UITour_task(async function test_aboutNewTab_invalidHash() {
  let newTabLoaded = BrowserTestUtils.browserLoaded(
    gBrowser.selectedBrowser,
    false,
    "about:newtab"
  );
  info("Showing about:newtab with an invalid hash");
  await gContentAPI.showNewTab("bad#hash");
  info("Waiting for about:newtab to load");
  await newTabLoaded;
  is(
    gBrowser.selectedBrowser.currentURI.spec,
    "about:newtab",
    "Invalid hash is ignored"
  );
});
