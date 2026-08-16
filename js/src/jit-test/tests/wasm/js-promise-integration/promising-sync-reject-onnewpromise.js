// |jit-test| skip-if: !wasmJSPromiseIntegrationEnabled()
//
// When a WebAssembly.promising call fails synchronously (here the Suspending
// import throws before suspending), the wrapper converts the failure into a
// rejected promise. Creating that promise fires the Debugger onNewPromise
// hook, which runs debugger-supplied JS. The engine forbids running JS while
// an exception is pending: a debug build asserts !cx->isExceptionPending() at
// the next interrupt check; a release build silently runs the hook with the
// stale pending exception (later consumed when the promise is rejected).
//
// Note what onNewPromise itself does "wrong": essentially nothing. Per the
// Debugger API it is only a notification hook observing promise allocation --
// it receives a Debugger.Object for the promise, cannot alter the promise, and
// requires an attached Debugger. So a real handler is very unlikely to exploit
// the pending-exception window; the defect is that the engine reaches that
// illegal state at all. See
// https://firefox-source-docs.mozilla.org/devtools-user/debugger-api/debugger/index.html
//
// The fix lifts the pending exception across promise creation so the hook runs
// with clean error state, then rejects the promise with the original error.

// Run a WebAssembly.promising call whose Suspending import throws
// synchronously, after `configure(dbg)` installs the debugger's hooks. Returns
// the settled { status, reason } of the promise the wrapper produced.
function runPromisingFailure(configure) {
  var g = newGlobal({newCompartment: true});
  var dbg = new Debugger(g);
  configure(dbg);

  g.eval(`
    var bin = wasmTextToBinary(
      '(module (import "m" "s" (func $s)) (func (export "main") (call $s)))');
    var ins = new WebAssembly.Instance(new WebAssembly.Module(bin),
      {m: {s: new WebAssembly.Suspending(() => { throw new Error("boom"); })}});
    var f = WebAssembly.promising(ins.exports.main);

    var status = "pending";
    var reason = null;
    f().then(v => { status = "fulfilled"; },
             e => { status = "rejected"; reason = e && e.message; });
  `);
  drainJobQueue();
  return { status: g.eval("status"), reason: g.eval("reason") };
}

// 1) A plain observing onNewPromise hook must run (with clean error state,
//    rather than crashing) and the promise must still reject with the original
//    error rather than fulfilling or losing it.
var sawNewPromise = false;
var r1 = runPromisingFailure(dbg => {
  dbg.onNewPromise = function (p) { sawNewPromise = true; };
});
assertEq(sawNewPromise, true);
assertEq(r1.status, "rejected");
assertEq(r1.reason, "boom");

// 2) An onNewPromise hook that returns a (disallowed) resumption value. The
//    debugger raises JSMSG_DEBUG_RESUMPTION_VALUE_DISALLOWED ("resumption
//    values are disallowed in this hook"), which surfaces through
//    uncaughtExceptionHook. This exercises the branch of firePromiseHook that
//    creates a *second* error while the wasm exception is (pre-fix) pending;
//    the original failure must still reject the promise with "boom", and the
//    disallowed-resumption error must not leak into the debuggee.
var caught = null;
var r2 = runPromisingFailure(dbg => {
  dbg.onNewPromise = function (p) { return { return: 1 }; };
  dbg.uncaughtExceptionHook = function (e) { caught = String(e); };
});
assertEq(caught !== null && /resumption values are disallowed/.test(caught),
         true);
assertEq(r2.status, "rejected");
assertEq(r2.reason, "boom");
