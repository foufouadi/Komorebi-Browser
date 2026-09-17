/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.listentopage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private const val TAB_ID = "tab-1"
private const val URL = "https://example.org/article"

/** A session with every field set, so a reset is visible in every one of them. */
private val fullState =
    ListenState(
        tabId = TAB_ID,
        url = URL,
        title = "Match Preview: Wrexham AFC vs Sunderland AFC",
        languageTag = "de-DE",
        mode = ListenMode.Player,
        error = ListenError.PlaybackFailed,
        voiceState = VoiceState(availableVoices = listOf("Gonzo", "Animal", "Kermit").map { Voice(it) }),
        playbackState =
            PlaybackState(
                phase = PlaybackPhase.Playing,
                chunk = ChunkState(index = 3, durationMs = 30_000),
                positionMs = 12_000,
            ),
    )

class ListenReducerTest {

    @Test
    fun `test that a listen request starts a session on the given tab`() {
        val state = listenReducer(ListenState(), ListenAction.Session.ListenRequested(TAB_ID, URL))

        assertEquals(TAB_ID, state.tabId)
    }

    @Test
    fun `test that a listen request drops everything the previous session held`() {
        val state = listenReducer(fullState, ListenAction.Session.ListenRequested("tab-2", URL))

        assertEquals("tab-2", state.tabId)
        assertEquals(URL, state.url)
        assertNull(state.title)
        assertNull(state.error)
        assertEquals(ListenMode.Player, state.mode)
        assertEquals("de-DE", state.languageTag)
        assertEquals(fullState.voiceState, state.voiceState) // here
        assertEquals(PlaybackState(), state.playbackState)
    }

    @Test
    fun `test that a listen request records the article url`() {
        val state = listenReducer(ListenState(), ListenAction.Session.ListenRequested(TAB_ID, URL))

        assertEquals(URL, state.url)
    }

    @Test
    fun `test that stopping resets appropriate fields`() {
        assertEquals(
            ListenState(voiceState = fullState.voiceState.copy()),
            listenReducer(fullState, ListenAction.Session.StopRequested),
        )
    }

    @Test
    fun `test that dismissing an error clears it and leaves the session alone`() {
        val state = listenReducer(fullState, ListenAction.ErrorDismissed)

        assertNull(state.error)
        assertEquals(fullState.copy(error = null), state)
    }

    @Test
    fun `test that dismissing clears every kind of error`() {
        val errors =
            listOf(
                ListenError.NoOfflineVoice,
                ListenError.ContentUnavailable,
                ListenError.SynthesisFailed,
                ListenError.PlaybackFailed,
            )

        errors.forEach { error ->
            val state = listenReducer(fullState.copy(error = error), ListenAction.ErrorDismissed)

            assertNull("$error was not cleared", state.error)
        }
    }

    @Test
    fun `test that dismissing when there is no error changes nothing`() {
        val noError = fullState.copy(error = null)

        assertEquals(noError, listenReducer(noError, ListenAction.ErrorDismissed))
    }

    @Test
    fun `test that selecting a voice records it`() {
        val state = listenReducer(ListenState(), ListenAction.Voices.VoiceSelected(Voice(id = "en-us-female")))

        assertEquals(Voice(id = "en-us-female"), state.voiceState.selectedVoice)
    }

    @Test
    fun `test that loaded voices are recorded`() {
        val voices = listOf(Voice(id = "en-us-female"), Voice(id = "en-us-male"))

        val state = listenReducer(ListenState(), ListenAction.Voices.AvailableVoicesLoaded(voices, voices.first()))

        assertEquals(voices, state.voiceState.availableVoices)
    }

    @Test
    fun `test that loading voices again replaces the voices of the previous language`() {
        val german = listOf(Voice("de-de"))
        val loaded = listenReducer(ListenState(), ListenAction.Voices.AvailableVoicesLoaded(german, german.first()))

        val english = listOf(Voice("en-us"))
        val state = listenReducer(loaded, ListenAction.Voices.AvailableVoicesLoaded(english, english.first()))

        assertEquals(english, state.voiceState.availableVoices)
    }

    @Test
    fun `test that loading voices records the voice they were resolved for`() {
        val voices = listOf(Voice(id = "en-us-female"), Voice(id = "en-us-male"))

        val state =
            listenReducer(
                fullState,
                ListenAction.Voices.AvailableVoicesLoaded(voices, selectedVoice = Voice(id = "en-us-male")),
            )

        assertEquals(voices, state.voiceState.availableVoices)
        assertEquals(Voice(id = "en-us-male"), state.voiceState.selectedVoice)
    }

    @Test
    fun `test that having no offline voice is reported as an error`() {
        val state = listenReducer(ListenState(), ListenAction.Voices.NoOfflineVoicesAvailable)

        assertEquals(ListenError.NoOfflineVoice, state.error)
    }

    @Test
    fun `test that having no offline voice leaves the article alone`() {
        val state = listenReducer(fullState.copy(error = null), ListenAction.Voices.NoOfflineVoicesAvailable)

        assertEquals(fullState.copy(error = ListenError.NoOfflineVoice), state)
    }

    @Test
    fun `test that a session has no voices by default`() {
        val initial = ListenState()

        assertEquals(emptyList<Voice>(), initial.voiceState.availableVoices)
        assertNull(initial.voiceState.selectedVoice)
    }

    @Test
    fun `test that a failed synthesis becomes an error the session can show`() {
        val state = listenReducer(ListenState(tabId = "tab-1"), ListenAction.Synthesis.SynthesisFailed)

        assertEquals(ListenError.SynthesisFailed, state.error)
        assertEquals("tab-1", state.tabId)
    }

    @Test
    fun `test that a failed synthesis can be dismissed`() {
        val failed = listenReducer(ListenState(tabId = "tab-1"), ListenAction.Synthesis.SynthesisFailed)

        val dismissed = listenReducer(failed, ListenAction.ErrorDismissed)

        assertNull(dismissed.error)
    }

    @Test
    fun `test that a session has no tab, no error and the player mode by default`() {
        val initial = ListenState()

        assertNull(initial.tabId)
        assertNull(initial.url)
        assertNull(initial.title)
        assertNull(initial.languageTag)
        assertNull(initial.error)
        assertEquals(ListenMode.Player, initial.mode)
    }

    @Test
    fun `test that an article in the language of the previous one keeps its voices`() {
        val state = listenReducer(fullState, ListenAction.Content.ContentReady(languageTag = "de-DE"))

        assertEquals(fullState, state)
    }

    @Test
    fun `test that an article in another language drops the voices of the previous one`() {
        val state = listenReducer(fullState, ListenAction.Content.ContentReady(languageTag = "fr-FR"))

        assertEquals("fr-FR", state.languageTag)
        assertEquals(VoiceState(), state.voiceState)
    }

    @Test
    fun `test that a session is playing nothing by default`() {
        val initial = ListenState()

        assertEquals(PlaybackPhase.Idle, initial.playbackState.phase)
        assertEquals(0, initial.playbackState.chunk.index)
        assertEquals(0, initial.playbackState.positionMs)
        assertNull(initial.playbackState.chunk.durationMs)
    }

    @Test
    fun `test that what the player reports is recorded`() {
        val reported = PlaybackState(phase = PlaybackPhase.Playing, chunk = ChunkState(index = 2), positionMs = 4_000)

        val state = listenReducer(ListenState(), ListenAction.Playback.StateChangeObserved(reported))

        assertEquals(reported, state.playbackState)
    }

    @Test
    fun `test that what the player reports leaves the rest of the session alone`() {
        val reported = PlaybackState(phase = PlaybackPhase.Paused, positionMs = 1_000)

        val state = listenReducer(fullState, ListenAction.Playback.StateChangeObserved(reported))

        assertEquals(fullState.copy(playbackState = reported), state)
    }

    @Test
    fun `test that a failed player is reported as an error`() {
        val state =
            listenReducer(
                ListenState(),
                ListenAction.Playback.StateChangeObserved(PlaybackState(phase = PlaybackPhase.Failed)),
            )

        assertEquals(ListenError.PlaybackFailed, state.error)
        assertEquals(PlaybackPhase.Failed, state.playbackState.phase)
    }

    // An error the user has not seen yet outlives a report that has nothing to say about it, so that a phase change
    // arriving in between cannot take the dialog away.
    @Test
    fun `test that a player with nothing wrong leaves an existing error alone`() {
        val state =
            listenReducer(
                fullState.copy(error = ListenError.SynthesisFailed),
                ListenAction.Playback.StateChangeObserved(PlaybackState(phase = PlaybackPhase.Paused)),
            )

        assertEquals(ListenError.SynthesisFailed, state.error)
    }
}
