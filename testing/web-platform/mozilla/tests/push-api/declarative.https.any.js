// META: global=window-module
// META: script=/_mozilla/resources/GleanTest.js
// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: script=/notifications/resources/helpers.js
// META: script=/_mozilla/notifications/resources/MockAlertsService.js

import { encrypt } from "/push-api/resources/helpers.js"

// Tests for Declarative Web Push
// https://w3c.github.io/push-api/#declarative-push-message

const OPEN_URI = new URL("/_mozilla/notifications/resources/broadcast-when-opened.html", location).href;

let registration;
let subscription;

promise_setup(async () => {
  await trySettingPermission("granted");
  registration = await prepareActiveServiceWorker("push-sw.js");
  subscription = await registration.pushManager.subscribe();
});

async function sendPush(t, message) {
  await MockAlertsService.register(t);
  await MockAlertsService.enableAutoClick();

  const {promise, resolve} = Promise.withResolvers();
  const signal = t.get_signal();

  new BroadcastChannel("broadcast-when-opened").addEventListener("message", async e => {
    const notifications = await MockAlertsService.getNotificationData();
    assert_equals(notifications.length, 1,
                  "Should have exactly one notification.");
    const notificationData = notifications[0];
    assert_equals(e.data, "opened");
    const swrNotifications = await registration.getNotifications();
    assert_equals(swrNotifications.length, 1,
                  "ServiceWorkerRegistration.getNotifications() should return exactly 1 notification.");
    const swrNotification = swrNotifications[0];
    assert_equals(swrNotification.title, notificationData.title,
                  "title given in ServiceWorkerRegistration.getNotifications() should be correct.");
    // Navigate URL is not stored in the AlertNotification
    notificationData.navigate = swrNotification.navigate;
    resolve({dwp: notificationData});
  }, {signal});
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data.data) {
      resolve({swPush: true});
    }
  }, {signal});


  const result = await encrypt(
    message instanceof Uint8Array ? message : new TextEncoder().encode(message),
    subscription.getKey("p256dh"),
    subscription.getKey("auth")
  );

  await fetch(subscription.endpoint, {
    method: "post",
    ...result
  });
  return promise;
}

async function testNonDWP(t, message) {
  const result = await sendPush(t, message);
  assert_true(result.swPush, "Should receive a service worker push event.");
}

async function testDWP(t, pushData) {
  const result = await sendPush(t, JSON.stringify(pushData));
  assert_true(!!result.dwp, "Should be interpreted as a DWP.");
  assert_equals(result.dwp.title, pushData.notification.title,
                "Notification title should be set correctly.");
  assert_equals(result.dwp.navigate, new URL(pushData.notification.navigate, location).href,
                "Notification navigate should be set correctly.");
}

const SIMPLE_DWP = { "web_push": 8030, notification: { title: "test title", navigate: OPEN_URI } };

promise_test(t => testDWP(t, SIMPLE_DWP), "Declarative web push works");

promise_test(async t => {
  const pushData = structuredClone(SIMPLE_DWP);
  pushData.notification.navigate = new URL(OPEN_URI).pathname;
  await testDWP(t, pushData);
}, "DWP allows relative URLs for notification.navigate");

promise_test(async t => {
  const pushString = JSON.stringify(SIMPLE_DWP);
  const pushBytes = new TextEncoder().encode(pushString);
  pushBytes[pushString.indexOf("test title")] = 0xff;
  const result = await sendPush(t, pushBytes);
  assert_true(!!result.dwp, "Should be interpreted as DWP.");
  assert_equals(result.dwp.title, "\uFFFDest title",
                "Invalid UTF-8 should be replaced with U+FFFD replacement character in title.");
}, "DWP accepts invalid UTF-8 and uses replacement character");

promise_test(async t => {
  await testNonDWP(t, JSON.stringify(SIMPLE_DWP).slice(1));
}, "Invalid JSON is not treated as DWP");

promise_test(async t => {
  await testNonDWP(t, JSON.stringify([SIMPLE_DWP]));
}, "JSON with top-level array is not treated as DWP");

promise_test(async t => {
  await testNonDWP(t, JSON.stringify({x: SIMPLE_DWP}));
}, "JSON with DWP data embedded in another object is not treated as DWP");

promise_test(async t => {
  const pushData = structuredClone(SIMPLE_DWP);
  pushData.web_push = 8031;
  await testNonDWP(t, JSON.stringify(pushData));
}, "JSON with web_push ≠ 8030 is not treated as DWP");

promise_test(async t => {
  const pushData = structuredClone(SIMPLE_DWP);
  delete pushData.notification.title;
  await testNonDWP(t, JSON.stringify(pushData));
}, "JSON with no notification.title is not treated as DWP");

promise_test(async t => {
  const pushData = structuredClone(SIMPLE_DWP);
  delete pushData.notification.navigate;
  await testNonDWP(t, JSON.stringify(pushData));
}, "JSON with no notification.navigate is not treated as DWP");


promise_test(async t => {
  const pushData = structuredClone(SIMPLE_DWP);
  pushData.notification.navigate = "http://999.999";
  await testNonDWP(t, JSON.stringify(pushData));
}, "JSON with invalid notification.navigate is not treated as DWP");
