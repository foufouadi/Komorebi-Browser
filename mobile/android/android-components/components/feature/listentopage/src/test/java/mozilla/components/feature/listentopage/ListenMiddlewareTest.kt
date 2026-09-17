/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.listentopage

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import mozilla.components.feature.listentopage.content.Content
import mozilla.components.feature.listentopage.content.ContentProvider
import mozilla.components.feature.listentopage.content.TextChunker
import mozilla.components.feature.listentopage.fakes.FakeAudioFileCache
import mozilla.components.feature.listentopage.fakes.FakePlaybackController
import mozilla.components.feature.listentopage.fakes.FakeSpeechSynthesizer
import mozilla.components.feature.listentopage.playback.AudioFileCache
import mozilla.components.feature.listentopage.playback.DirectoryAudioFileCache
import mozilla.components.feature.listentopage.playback.PlaybackController
import mozilla.components.feature.listentopage.settings.ListenSettings
import mozilla.components.feature.listentopage.synthesis.NoOfflineVoiceAvailableException
import mozilla.components.feature.listentopage.synthesis.SpeechSynthesisException
import mozilla.components.feature.listentopage.synthesis.SpeechSynthesizer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith

private const val TAB_ID = "tab-1"
private const val OTHER_TAB_ID = "tab-2"
private const val URL = "https://example.org/article"
private const val ENGINE = "com.example.tts"

/** A chunker that finds nothing to read in anything, which the real one does only for text with no words in it. */
private object NothingToChunk : TextChunker {
    override fun chunk(text: String, maxInputLength: Int, languageTag: String): List<String> = emptyList()

    override fun firstSentenceEnd(text: String, languageTag: String): Int = text.length
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class ListenMiddlewareTest {

    @get:Rule val temporaryFolder = TemporaryFolder()

    // The middleware watches the player for as long as a session lasts, so its scope cannot be the test's own: runTest
    // waits for that scope's children and the watch never finishes on its own. These share the test's scheduler, so
    // advanceUntilIdle still drives them, but they are nobody's child and so nothing waits on them.
    private val middlewareScopes = mutableListOf<CoroutineScope>()

    @After
    fun tearDown() {
        middlewareScopes.forEach { it.cancel() }
        middlewareScopes.clear()
    }

    @Test
    fun `test that the article of the requested tab is extracted and its language recorded`() = runTest {
        var extractedTabId: String? = null
        val store = storeWith { tabId ->
            extractedTabId = tabId
            Result.success(Content(text = "Article text", languageTag = "de-DE"))
        }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(TAB_ID, extractedTabId)
        assertEquals("de-DE", store.state.languageTag)
        assertNull(store.state.error)
    }

    @Test
    fun `test that a failed extraction reports the content as unavailable`() = runTest {
        val store = storeWith { Result.failure(RuntimeException("Content failed")) }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.ContentUnavailable, store.state.error)
        assertNull(store.state.languageTag)
    }

    @Test
    fun `test that a page with no usable text reports the content as unavailable`() = runTest {
        val store = storeWith { Result.success(Content(text = "   ", languageTag = "en-US")) }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.ContentUnavailable, store.state.error)
        assertNull(store.state.languageTag)
    }

    @Test
    fun `test that an article extracted after the session stopped is dropped`() = runTest {
        val extraction = CompletableDeferred<Result<Content>>()
        val store = storeWith { extraction.await() }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.StopRequested)
        extraction.complete(Result.success(Content(text = "Article text", languageTag = "de-DE")))
        advanceUntilIdle()

        assertEquals(ListenState(), store.state)
    }

    @Test
    fun `test that the voices of the article language are loaded once the article is ready`() = runTest {
        val voices = listOf(Voice(id = "de-de-female"), Voice(id = "de-de-male"))
        val synthesizer = FakeSpeechSynthesizer(voices = voices)
        val store =
            storeWith(synthesizerProvider = { synthesizer }) {
                Result.success(Content(text = "Article text", languageTag = "de-DE"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(listOf("de-DE"), synthesizer.voiceRequests)
        assertEquals(voices, store.state.voiceState.availableVoices)
        assertEquals(Voice(id = "de-de-female"), store.state.voiceState.selectedVoice)
        assertNull(store.state.error)
    }

    @Test
    fun `test that an article language with no offline voice is reported as an error`() = runTest {
        val store =
            storeWith(synthesizerProvider = { FakeSpeechSynthesizer(voices = emptyList()) }) {
                Result.success(Content(text = "Article text", languageTag = "ja-JP"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.NoOfflineVoice, store.state.error)
        assertTrue(store.state.voiceState.availableVoices.isEmpty())
    }

    @Test
    fun `test that no voices are loaded when the article could not be extracted`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) { Result.failure(RuntimeException("Content failed")) }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertTrue(synthesizer.voiceRequests.isEmpty())
        assertEquals(ListenError.ContentUnavailable, store.state.error)
    }

    @Test
    fun `test that the extracted article is synthesized and played`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(listOf("Article text."), synthesizer.requests)
        assertEquals(listOf(File("/audio/1.wav")), playback.played)
    }

    @Test
    fun `test that the article is opened on its first sentence`() = runTest {
        val synthesizer = FakeSpeechSynthesizer(maxInputLength = 20)
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = "One. Two. Three is over the limit.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // The requests after it are the queue working ahead of what is playing.
        assertEquals("One.", synthesizer.requests.first())
        assertEquals(1, playback.played.size)
    }

    @Test
    fun `test that an article with no sentence end that fits is cut at the engine limit`() = runTest {
        val synthesizer = FakeSpeechSynthesizer(maxInputLength = 5)
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = "abcdefghij", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals("abcde", synthesizer.requests.first())
    }

    @Test
    fun `test that the first request is one sentence, not everything the engine accepts`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val article = (1..100).joinToString(" ") { "Sentence $it is right here." }
        val store =
            storeWith(synthesizerProvider = { synthesizer }) {
                Result.success(Content(text = article, languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // The article is inside the engine's limit, so before this it went to the engine in one request and nothing
        // played until the whole of it had been synthesized.
        assertEquals("Sentence 1 is right here.", synthesizer.requests.first())
        assertTrue(article.length > synthesizer.requests.first().length * 50)
    }

    @Test
    fun `test that an article declaring no language is not read out`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) {
                Result.success(Content(text = "An article with no language. It does not read.", languageTag = ""))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.ContentUnavailable, store.state.error)
        assertEquals(emptyList<String>(), synthesizer.requests)
        assertNull(store.state.languageTag)
    }

    @Test
    fun `test that an article declaring a language with the wrong separator is repaired and read out`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) {
                Result.success(Content(text = "An article with a POSIX tag. It still reads.", languageTag = "en_US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // The repaired tag, not the one the page gave, is what the article is read as and what its voices are looked
        // up for. Repairing per consumer is how a session ends up reading an article aloud while also reporting that
        // it has no voice for the language.
        assertEquals("en-US", store.state.languageTag)
        assertEquals(listOf("en-US"), synthesizer.voiceRequests)
        assertEquals("An article with a POSIX tag.", synthesizer.requests.first())
        assertNull(store.state.error)
    }

    @Test
    fun `test that an article declaring a malformed language is not read out`() = runTest {
        listOf("-en", "e", "  ").forEach { tag ->
            val synthesizer = FakeSpeechSynthesizer()
            val store =
                storeWith(synthesizerProvider = { synthesizer }) {
                    Result.success(Content(text = "An article with a bad tag. It does not read.", languageTag = tag))
                }
            store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
            advanceUntilIdle()

            assertEquals("Read out <$tag>", emptyList<String>(), synthesizer.requests)
            assertEquals("No error for <$tag>", ListenError.ContentUnavailable, store.state.error)
        }
    }

    @Test
    fun `test that a synthesis failure does not play anything`() = runTest {
        val playback = FakePlaybackController()
        val failing =
            object : SpeechSynthesizer {
                override val maxInputLength = 4000

                override val enginePackageName = "com.example.tts"

                override suspend fun synthesizeToFile(text: String): File = throw SpeechSynthesisException(-1)

                override fun close() = Unit

                override fun loadAvailableVoices(langTag: String): List<Voice> = emptyList()
            }
        val store =
            storeWith(synthesizerProvider = { failing }, playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertTrue(playback.played.isEmpty())
    }

    @Test
    fun `test that a synthesis failure is reported rather than only logged`() = runTest {
        val failing =
            object : SpeechSynthesizer {
                override val maxInputLength = 4000

                override val enginePackageName = "com.example.tts"

                override suspend fun synthesizeToFile(text: String): File = throw SpeechSynthesisException(-1)

                override fun close() = Unit

                override fun loadAvailableVoices(langTag: String): List<Voice> = listOf(Voice(id = "en-us-female"))
            }
        val store =
            storeWith(synthesizerProvider = { failing }) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.SynthesisFailed, store.state.error)
    }

    // The voice list is not empty here, so the error can only have come from the synthesis path rather than from the
    // check that reports a language with no offline voice before anything is synthesized.
    @Test
    fun `test that a synthesis failing for want of an offline voice reports it as an error`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { failingSynthesizer { throw NoOfflineVoiceAvailableException() } },
                playbackController = playback,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.NoOfflineVoice, store.state.error)
        assertTrue(playback.played.isEmpty())
    }

    @Test
    fun `test that a synthesis failing for reasons other than an offline voice is reported`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { failingSynthesizer { throw SpeechSynthesisException(-1) } },
                playbackController = playback,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(ListenError.SynthesisFailed, store.state.error)
        assertTrue(playback.played.isEmpty())
    }

    @Test
    fun `test that the chunk after the one that ended is played`() = runTest {
        val synthesizer = FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root)
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        val opening = playback.played.single()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
        advanceUntilIdle()

        assertEquals(2, playback.played.size)
        assertNotEquals(opening, playback.played.last())
    }

    @Test
    fun `test that the article keeps going for as long as chunks are left`() = runTest {
        val synthesizer = FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root)
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        repeat(4) {
            // Both are observed, because a StateFlow drops a value equal to the one before it and every chunk ends
            // with the same report. In the app the player publishes Buffering when the next chunk is handed to it.
            playback.status.value = PlaybackState(phase = PlaybackPhase.Playing)
            advanceUntilIdle()
            playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
            advanceUntilIdle()
        }

        // Five files in reading order, none of them played twice.
        assertEquals(5, playback.played.size)
        assertEquals(playback.played.distinct(), playback.played)
    }

    @Test
    fun `test that the end of the last chunk ends the article rather than looping`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root) },
                playbackController = playback,
            ) {
                Result.success(Content(text = "The only sentence there is.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
        advanceUntilIdle()

        assertEquals(1, playback.played.size)
    }

    @Test
    fun `test that a report which is not the end of a chunk plays nothing new`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root) },
                playbackController = playback,
            ) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        listOf(PlaybackPhase.Playing, PlaybackPhase.Paused, PlaybackPhase.Buffering).forEach {
            playback.status.value = PlaybackState(phase = it, positionMs = 1_000)
            advanceUntilIdle()
        }

        assertEquals(1, playback.played.size)
    }

    @Test
    fun `test that the end of a chunk reported twice moves the article on only once`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = {
                    FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root, timePerRequest = 1.seconds)
                },
                playbackController = playback,
            ) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))

        // Far enough for the opening to be playing, not far enough for the chunk the lookahead started behind it to be
        // finished, so that the move to the next chunk is still waiting its turn when the second report arrives.
        advanceTimeBy(1500.milliseconds)
        assertEquals(1, playback.played.size)

        // The positions differ only so that the two reports are different values. A StateFlow drops a value equal to
        // the one before it, so repeating the same position would leave the second report undelivered and the test
        // passing without ever exercising the guard. Neither number stands for anything the player measured.
        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended, positionMs = 30_000)
        advanceTimeBy(10.milliseconds)
        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended, positionMs = 30_004)
        advanceUntilIdle()

        assertEquals(2, playback.played.size)
    }

    @Test
    fun `test that the end of each chunk in turn moves the article on again`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root) },
                playbackController = playback,
            ) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // Three ends in a row, each one reported after the chunk it belongs to started playing, which is what the
        // player does. Playing a chunk publishes a phase of its own, so nothing here has to fake one.
        repeat(3) {
            playback.status.value = PlaybackState(phase = PlaybackPhase.Ended, positionMs = 30_000)
            advanceUntilIdle()
        }

        assertEquals(4, playback.played.size)
    }

    @Test
    fun `test that a chunk ending with the player never seen starting it still moves the article on`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root) },
                playbackController = playback,
            ) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended, positionMs = 30_000)
        advanceUntilIdle()
        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended, positionMs = 60_000)
        advanceUntilIdle()

        assertEquals(3, playback.played.size)
        assertEquals(playback.played.distinct(), playback.played)
        assertNull(store.state.error)
    }

    @Test
    fun `test that failing to work ahead does not put an error over a player still reading`() = runTest {
        // The opening and the chunk after it are made; the one after that is not. Nobody is waiting on it, so the
        // article carries on and the reader is told nothing.
        val synthesizer = FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root, failAtRequest = 3)
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(1, playback.played.size)
        assertNull(store.state.error)

        // And the article still moves on, onto the chunk that was made before the failure.
        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
        advanceUntilIdle()

        assertEquals(2, playback.played.size)
        assertNull(store.state.error)
    }

    @Test
    fun `test that a chunk the lookahead never made is made on its own when playback reaches it`() = runTest {
        // The lookahead fails on the chunk after the opening, so the move to it has to make it. Only it: making the
        // whole window first would keep the reader waiting for the two chunks beyond the one they are waiting on.
        val synthesizer =
            FakeSpeechSynthesizer(
                audioDirectory = temporaryFolder.root,
                timePerRequest = 1.seconds,
                failAtRequest = 2,
            )
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(1, playback.played.size)

        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
        advanceTimeBy(1100.milliseconds)

        assertEquals(2, playback.played.size)
    }

    @Test
    fun `test that the lookahead is not thrown away by the move to the next chunk`() = runTest {
        // Every chunk of the window is asked for once. Cancelling the request in flight to move the article on made
        // the engine do the same chunk again, and left the half-written file behind with nothing tracking it.
        val synthesizer =
            FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root, timePerRequest = 500.milliseconds)
        val playback = FakePlaybackController()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, playbackController = playback) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        repeat(3) {
            playback.status.value = PlaybackState(phase = PlaybackPhase.Playing)
            advanceUntilIdle()
            playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
            advanceUntilIdle()
        }

        assertEquals(synthesizer.requests.distinct(), synthesizer.requests)
    }

    @Test
    fun `test that a request in place of a live session stops the one before it moving on`() = runTest {
        val playback = FakePlaybackController()
        val extraction = CompletableDeferred<Result<Content>>()
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root) },
                playbackController = playback,
            ) { tabId ->
                if (tabId == TAB_ID) {
                    Result.success(Content(text = longArticle(), languageTag = "en-US"))
                } else {
                    extraction.await()
                }
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        val readSoFar = playback.played.size

        // The second session is still being extracted, and the player still holds the first article's opening. The end
        // of that opening belongs to a session the reader has left, so it must not read out another of its chunks.
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()
        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
        advanceUntilIdle()

        assertEquals(readSoFar, playback.played.size)

        // Let the second extraction finish, so the middleware has nothing left running when the body returns.
        extraction.complete(Result.failure(RuntimeException("Extraction abandoned")))
        advanceUntilIdle()
    }

    @Test
    fun `test that a request in place of a live session throws away only that session's audio`() = runTest {
        val cache = FakeAudioFileCache()
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }, audioCache = cache) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // A session replacing another keeps the engine, so this one fake writes for both and its files stay uniquely
        // named across them. Everything it wrote up to here belongs to the article the reader is leaving.
        val leftBehind = synthesizer.files.toList()

        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()

        assertTrue("Nothing was made to delete", leftBehind.isNotEmpty())
        assertEquals(leftBehind.toSet(), cache.deleted.toSet())
        assertFalse(cache.cleared)
    }

    @Test
    fun `test that a session starting while the last one is still ending keeps its own audio`() = runTest {
        val directory = temporaryFolder.newFolder("audio")
        val cache = slowToEmpty(DirectoryAudioFileCache({ directory }, ioDispatcher = Dispatchers.Unconfined))
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = directory) },
                audioCache = cache,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // Nothing advanced between them, so the stop is still emptying the cache directory when the session after it
        // starts writing into it. Emptying is a recursive delete of the directory both of them share.
        store.dispatch(ListenAction.Session.StopRequested)
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()

        assertTrue("The new session's audio was deleted under it", directory.list().orEmpty().isNotEmpty())
    }

    @Test
    fun `test that an article the chunker finds nothing to read in is reported as unavailable content`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(
                synthesizerProvider = { synthesizer },
                chunker = NothingToChunk,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        // The page is what had nothing in it, so the reader gets the snackbar for an article that cannot be read and
        // not the dialog that an engine failing part way through an article puts over the player.
        assertEquals(ListenError.ContentUnavailable, store.state.error)
        assertEquals(emptyList<String>(), synthesizer.requests)
    }

    @Test
    fun `test that a new session starts from its own opening rather than where the last one had got to`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(audioDirectory = temporaryFolder.root) },
                playbackController = playback,
            ) {
                Result.success(Content(text = longArticle(), languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        playback.status.value = PlaybackState(phase = PlaybackPhase.Ended)
        advanceUntilIdle()
        val secondChunk = playback.played.last()

        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()

        assertNotEquals(secondChunk, playback.played.last())
    }

    @Test
    fun `test that stopping the session gives up the playback`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()

        assertTrue(playback.released)
    }

    @Test
    fun `test that stopping waits for a request the engine has already taken before emptying the cache`() = runTest {
        val directory = File(temporaryFolder.root, "audio")
        val cache = DirectoryAudioFileCache({ directory }, ioDispatcher = Dispatchers.Unconfined)
        val store =
            storeWith(synthesizerProvider = { lateWritingSynthesizer(cache) }, audioCache = cache) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))

        // Stop while the engine still has the request, so its write lands after the session has been told to stop.
        advanceTimeBy(500.milliseconds)
        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()

        assertEquals(emptyList<String>(), directory.list()?.toList().orEmpty())
    }

    /**
     * An engine whose write cannot be cancelled, which is what the platform one is: the work is in another app's
     * process, so our cancellation asks it to stop but cannot un-write a file it has already produced.
     */
    private fun lateWritingSynthesizer(cache: AudioFileCache) =
        object : SpeechSynthesizer {
            override val maxInputLength = 4000

            override val enginePackageName = "com.example.tts"

            override suspend fun synthesizeToFile(text: String): File =
                withContext(NonCancellable) {
                    delay(1.seconds)
                    cache.create("late").apply { writeBytes(ByteArray(64)) }
                }

            override fun close() = Unit

            override fun loadAvailableVoices(langTag: String): List<Voice> = listOf(Voice(id = "voice-1"))
        }

    // The engine is an IPC binding that lives until it is shut down, and close() is terminal, so the next session has
    // to get an engine of its own.
    @Test
    fun `test that stopping the session closes the engine and the next session builds another`() = runTest {
        val engines = mutableListOf<FakeSpeechSynthesizer>()
        val store =
            storeWith(synthesizerProvider = { FakeSpeechSynthesizer().also(engines::add) }) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(1, engines.size)
        assertFalse(engines[0].closed)

        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()

        assertTrue(engines[0].closed)

        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(2, engines.size)
        assertFalse(engines[1].closed)
    }

    @Test
    fun `test that the engine is built once for a session`() = runTest {
        var built = 0
        val store =
            storeWith(synthesizerProvider = { FakeSpeechSynthesizer().also { built++ } }) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Content.ContentReady(languageTag = "en-US"))
        advanceUntilIdle()

        assertEquals(1, built)
    }

    @Test
    fun `test that stopping the session empties the audio cache`() = runTest {
        val audioCache = FakeAudioFileCache()
        val store =
            storeWith(audioCache = audioCache) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertFalse(audioCache.cleared)

        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()

        assertTrue(audioCache.cleared)
    }

    // The article carries the tab it came from, so a session cannot read the article the session before it left
    // behind, however the two raced.
    @Test
    fun `test that an article belonging to an earlier session is not read out`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val secondExtraction = CompletableDeferred<Result<Content>>()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) { tabId ->
                if (tabId == TAB_ID) {
                    Result.success(Content(text = "First article.", languageTag = "en-US"))
                } else {
                    secondExtraction.await()
                }
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(listOf("First article."), synthesizer.requests)

        // The second session never gets its own article, so the first one's is all that is left in the field.
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Content.ContentReady(languageTag = "en-US"))
        advanceUntilIdle()

        assertEquals(listOf("First article."), synthesizer.requests)

        // Let the second extraction finish, so the middleware has nothing left running when the body returns.
        secondExtraction.complete(Result.failure(RuntimeException("Extraction abandoned")))
        advanceUntilIdle()
    }

    @Test
    fun `test that the article is cleared when the session stops`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()

        // The article is gone, so nothing is left to synthesize a second time.
        store.dispatch(ListenAction.Content.ContentReady(languageTag = "en-US"))
        advanceUntilIdle()

        assertEquals(listOf("Article text."), synthesizer.requests)
    }

    @Test
    fun `test that the voice saved for the article language is the one selected`() = runTest {
        val voices = listOf(Voice(id = "en-us-female"), Voice(id = "en-us-male"))
        val settings = ListenSettings.inMemory(ENGINE, voiceIds = mapOf("en-US" to "en-us-male"))
        settings.setSelectedVoiceId("en-US", "en-us-male")
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(voices = voices, enginePackageName = ENGINE) },
                settings = settings,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(Voice(id = "en-us-male"), store.state.voiceState.selectedVoice) // here
    }

    @Test
    fun `test that a saved voice the engine no longer has falls back to the best one it does`() = runTest {
        val voices = listOf(Voice(id = "en-us-female"), Voice(id = "en-us-male"))
        val settings = ListenSettings.inMemory(ENGINE, voiceIds = mapOf("en-US" to "en-us-uninstalled"))
        settings.setSelectedVoiceId("en-US", "en-us-uninstalled")
        val store =
            storeWith(
                synthesizerProvider = { FakeSpeechSynthesizer(voices = voices, enginePackageName = ENGINE) },
                settings = settings,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(Voice(id = "en-us-female"), store.state.voiceState.selectedVoice)
        assertNull(store.state.error)
    }

    @Test
    fun `test that picking a voice saves it for the article language`() = runTest {
        val settings = ListenSettings.inMemory()
        val store =
            storeWith(settings = settings) {
                Result.success(Content(text = "Texte de l'article.", languageTag = "fr-FR"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Voices.VoiceSelected(Voice(id = "fr-fr-male")))
        advanceUntilIdle()

        assertEquals("fr-fr-male", settings.getSelectedVoiceId("fr-FR"))
    }

    @Test
    fun `test that switching the speech engine drops the voice saved for the article language`() = runTest {
        val voices = listOf(Voice(id = "en-us-female"), Voice(id = "en-us-male"))
        val settings = ListenSettings.inMemory()
        settings.clearSavedVoicesOnEngineChange("com.example.tts")
        settings.setSelectedVoiceId("en-US", "en-us-male")
        val store =
            storeWith(
                synthesizerProvider = {
                    FakeSpeechSynthesizer(voices = voices, enginePackageName = "com.example.other.tts")
                },
                settings = settings,
            ) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        assertEquals(Voice(id = "en-us-female"), store.state.voiceState.selectedVoice)
        assertNull(settings.getSelectedVoiceId("en-US"))
    }

    @Test
    fun `test that a session on an article in the same language does not ask the engine again`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(listOf("en-US"), synthesizer.voiceRequests)
    }

    @Test
    fun `test that a session on an article in another language asks the engine again`() = runTest {
        val synthesizer = FakeSpeechSynthesizer()
        val store =
            storeWith(synthesizerProvider = { synthesizer }) { tabId ->
                if (tabId == TAB_ID) {
                    Result.success(Content(text = "Article text.", languageTag = "en-US"))
                } else {
                    Result.success(Content(text = "Texte de l'article.", languageTag = "fr-FR"))
                }
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()

        assertEquals(listOf("en-US", "fr-FR"), synthesizer.voiceRequests)
    }

    @Test
    fun `test that what the player reports is recorded in the state`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        val reported =
            PlaybackState(
                phase = PlaybackPhase.Playing,
                chunk = ChunkState(index = 1, durationMs = 30_000),
                positionMs = 4_000,
            )
        playback.status.value = reported
        advanceUntilIdle()

        assertEquals(reported, store.state.playbackState)
    }

    // The notification's own controls and anything taking audio focus move the player without passing through the
    // store, so a state that followed the commands it sent would be wrong about whether audio is playing.
    @Test
    fun `test that a pause the store never asked for is still recorded`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Playing)
        advanceUntilIdle()
        playback.status.value = PlaybackState(phase = PlaybackPhase.Paused, positionMs = 9_000)
        advanceUntilIdle()

        assertEquals(PlaybackPhase.Paused, store.state.playbackState.phase)
        assertEquals(9_000, store.state.playbackState.positionMs)
    }

    @Test
    fun `test that a failing player is reported as an error`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Failed)
        advanceUntilIdle()

        assertEquals(ListenError.PlaybackFailed, store.state.error)
    }

    @Test
    fun `test that the player is no longer watched once the session stops`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Playing, positionMs = 4_000)
        advanceUntilIdle()

        assertEquals(PlaybackState(), store.state.playbackState)
    }

    // The player is watched from the request, not from the first thing played, because the session can fail before
    // anything is given to the player and the sheet still has to know it is not playing.
    @Test
    fun `test that the player is watched again by the session after a stop`() = runTest {
        val playback = FakePlaybackController()
        val store =
            storeWith(playbackController = playback) {
                Result.success(Content(text = "Article text.", languageTag = "en-US"))
            }
        store.dispatch(ListenAction.Session.ListenRequested(TAB_ID, URL))
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.StopRequested)
        advanceUntilIdle()
        store.dispatch(ListenAction.Session.ListenRequested(OTHER_TAB_ID, URL))
        advanceUntilIdle()

        playback.status.value = PlaybackState(phase = PlaybackPhase.Playing, positionMs = 4_000)
        advanceUntilIdle()

        assertEquals(PlaybackPhase.Playing, store.state.playbackState.phase)
    }

    /** An engine that offers a voice, so that only [synthesizeToFile] can fail a test that uses it. */
    private fun failingSynthesizer(failure: () -> Nothing) =
        object : SpeechSynthesizer {
            override val maxInputLength = 4000

            override val enginePackageName = "com.example.tts"

            override suspend fun synthesizeToFile(text: String): File = failure()

            override fun close() = Unit

            override fun loadAvailableVoices(langTag: String): List<Voice> = listOf(Voice(id = "voice-1"))
        }

    private fun longArticle() = (1..400).joinToString(" ") { "Sentence $it is right here." }

    /**
     * [cache], with the emptying slowed down enough for a session starting in the middle of it to be seen writing into
     * the directory it is deleting.
     */
    private fun slowToEmpty(cache: AudioFileCache) =
        object : AudioFileCache by cache {
            override suspend fun clear() {
                delay(1.seconds)
                cache.clear()
            }
        }

    private fun TestScope.storeWith(
        synthesizerProvider: () -> SpeechSynthesizer = { FakeSpeechSynthesizer() },
        playbackController: PlaybackController = FakePlaybackController(),
        audioCache: AudioFileCache = FakeAudioFileCache(),
        settings: ListenSettings = ListenSettings.inMemory(),
        chunker: TextChunker = TextChunker.android(),
        contentProvider: ContentProvider,
    ): ListenStore {
        val middlewareScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        middlewareScopes.add(middlewareScope)

        return ListenStore(
            initialState = ListenState(),
            reducer = ::listenReducer,
            middleware =
                listOf(
                    ListenMiddleware(
                        contentProvider = contentProvider,
                        synthesizerProvider = synthesizerProvider,
                        audioCache = audioCache,
                        playbackController = playbackController,
                        settings = settings,
                        scope = middlewareScope,
                        ioDispatcher = Dispatchers.Unconfined,
                        chunker = chunker,
                    )
                ),
        )
    }
}
