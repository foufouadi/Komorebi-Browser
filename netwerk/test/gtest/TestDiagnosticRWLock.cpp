/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Verifies the diagnostic added in bug 2059597: when nsHostResolver's DB lock
// stays held, a blocked writer gives up after network.dns.db_lock_timeout_ms
// and crashes (naming the holder) instead of hanging forever.

#include "gtest/gtest.h"
#include "mozilla/Preferences.h"
#include "mozilla/gtest/MozHelpers.h"
#include "nsHostResolver.h"

// The DiagnosticRWLock mechanism only exists in diagnostic builds. Death tests
// re-exec the test binary under the threadsafe style, which has no standalone
// executable on Android, so restrict this to platforms with usable death tests.
#if defined(MOZ_DIAGNOSTIC_ASSERT_ENABLED) && !defined(ANDROID) && \
    defined(GTEST_HAS_DEATH_TEST)

// Holding the read lock and then requesting the write lock on the same thread
// wedges it: TryWriteLock can never succeed and no further acquisition bumps
// the counter, so WriteLockOrDiagnose() must crash rather than return.
[[maybe_unused]] static void WedgeWriteLock() MOZ_NO_THREAD_SAFETY_ANALYSIS {
  ZERO_GDB_SLEEP();
  mozilla::net::DiagnosticRWLock lock("test.DiagnosticRWLock");
  lock.ReadLock();
  lock.WriteLockOrDiagnose();
}

// The crash reason only reaches stderr (where the death matcher reads it) in
// builds that print it; elsewhere just require that the process died.
#  if defined(DEBUG) || defined(MOZ_ASAN) || defined(FUZZING)
#    define WEDGE_CRASH_REGEX "nsHostResolver DB lock wedged"
#  else
#    define WEDGE_CRASH_REGEX ""
#  endif

// The "DeathTest" suite suffix makes gtest run this before non-death tests,
// minimizing the number of live threads present at fork() time.
TEST(DiagnosticRWLockDeathTest, WedgedLockCrashes)
{
  mozilla::Preferences::SetUint("network.dns.db_lock_timeout_ms", 3000);
  ASSERT_DEATH_WRAP(WedgeWriteLock(), WEDGE_CRASH_REGEX);
}

#endif  // MOZ_DIAGNOSTIC_ASSERT_ENABLED && !ANDROID && GTEST_HAS_DEATH_TEST
