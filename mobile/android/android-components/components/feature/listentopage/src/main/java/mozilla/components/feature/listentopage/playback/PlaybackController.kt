/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.listentopage.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import java.io.File
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import mozilla.components.feature.listentopage.ChunkState
import mozilla.components.feature.listentopage.PlaybackPhase
import mozilla.components.feature.listentopage.PlaybackState

/** Commands the playback of the synthesized audio. */
interface PlaybackController {
    /**
     * What the playback is doing, as the player reports it.
     *
     * It holds a default [PlaybackState] while no playback is connected.
     */
    val status: StateFlow<PlaybackState>

    /** Plays [file], replacing anything already playing. */
    suspend fun play(file: File)

    /** Pauses playback, keeping the position. */
    suspend fun pause()

    /** Resumes playback from the position it was paused at. */
    suspend fun resume()

    /** Moves playback to [positionMs] in the current audio. */
    suspend fun seekTo(positionMs: Long)

    /** Gives up the playback, which takes the notification away. A later call starts it again. */
    suspend fun release()
}

/**
 * A [PlaybackController] that drives [ListenMediaSessionService] through a [MediaController].
 *
 * This is the client half of the media session, and the only place in the module that holds a [MediaController]. It
 * exists so that a caller can drive playback without naming a media3 type, which a caller in Fenix cannot resolve.
 *
 * A [MediaController] may only be used on the main thread, so every method here moves to it. The connection is made on
 * first use and reused afterwards.
 *
 * @param context Used to connect to [ListenMediaSessionService].
 * @param scope The [CoroutineScope] the connection is held in.
 * @param ioDispatcher The dispatcher the service lookup runs on.
 */
class ListenPlaybackController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : PlaybackController {

    // Main thread only, like the controller it produces.
    private var connection: Deferred<MediaController>? = null

    private val _status = MutableStateFlow(PlaybackState())
    override val status: StateFlow<PlaybackState> = _status.asStateFlow()

    // Main thread only, like the controller it samples.
    private var positionJob: Job? = null

    private val playerListener =
        object : Player.Listener {
            // onEvents rather than the individual callbacks: it runs once per batch of changes, where the separate
            // callbacks would each publish a snapshot of the same batch.
            override fun onEvents(player: Player, events: Player.Events) {
                _status.value = player.toPlaybackState()
                samplePosition(player)
            }
        }

    override suspend fun play(file: File) = onController {
        // Published before the command, so that a report the previous session left behind cannot be read as this
        // session's in the time it takes the player to report for itself.
        _status.value = PlaybackState(phase = PlaybackPhase.Buffering)

        it.setMediaItem(file.toMediaItem())
        it.prepare()
        it.play()
    }

    override suspend fun pause() = onController { it.pause() }

    override suspend fun resume() = onController { it.play() }

    override suspend fun seekTo(positionMs: Long) = onController { it.seekTo(positionMs) }

    override suspend fun release() {
        withContext(Dispatchers.Main) {
            val released = connection ?: return@withContext
            connection = null
            forgetStatus()

            // A connection that failed has no controller to release.
            val controller = runCatching { released.await() }.getOrNull() ?: return@withContext

            controller.stop()
            controller.release()
        }
    }

    /**
     * Keeps [status] a second fresh while the audio plays, and stops sampling when it does not.
     *
     * The player reports the events but pushes no position, so the position has to be read. Only whole-second changes
     * are published.
     */
    private fun samplePosition(player: Player) {
        if (!player.isPlaying) {
            positionJob?.cancel()
            positionJob = null
            return
        }

        if (positionJob?.isActive == true) return

        positionJob =
            scope.launch(Dispatchers.Main) {
                while (true) {
                    // We sample faster than is required for publishing to ensure that data is up to date.
                    delay(POSITION_SAMPLE_INTERVAL_MS.milliseconds)

                    val sampled = player.currentPosition
                    _status.update {
                        if (it.positionMs / MS_PER_SECOND == sampled / MS_PER_SECOND) {
                            it
                        } else {
                            it.copy(positionMs = sampled)
                        }
                    }
                }
            }
    }

    /** Drops what the last connection was doing, so that nobody is left watching a session that is gone. */
    private fun forgetStatus() {
        positionJob?.cancel()
        positionJob = null
        _status.value = PlaybackState()
    }

    private suspend fun onController(command: (MediaController) -> Unit) =
        withContext(Dispatchers.Main) {
            command(connection?.await() ?: newConnection().await())
        }

    /**
     * Starts connecting, and keeps the attempt so that later commands reuse it.
     *
     * A failed attempt drops itself rather than being cached, because otherwise the first failure is replayed to every
     * later command and the session can never recover without restarting the process.
     */
    private fun newConnection(): Deferred<MediaController> =
        scope
            .async(Dispatchers.Main) { connect() }
            .also { connecting ->
                connection = connecting
                connecting.invokeOnCompletion { failure ->
                    if (failure != null && connection === connecting) {
                        connection = null
                    }
                }
            }

    private suspend fun connect(): MediaController {
        // The SessionToken constructor asks the package manager to resolve the service, which is a blocking IPC. Only
        // buildAsync below has to be on the main thread.
        val token =
            withContext(ioDispatcher) {
                SessionToken(context, ComponentName(context, ListenMediaSessionService::class.java))
            }
        val pending =
            MediaController.Builder(context, token)
                .setListener(
                    object : MediaController.Listener {
                        // The session goes away on its own, so a kept controller can go stale: media3 stops the
                        // service once the article ends with nobody commanding it. Commands sent to a disconnected
                        // controller are dropped without a word, so the next request has to build a new one.
                        override fun onDisconnected(controller: MediaController) {
                            connection = null
                            forgetStatus()
                        }
                    }
                )
                .buildAsync()

        val controller = suspendCancellableCoroutine { continuation ->
            // The listener only runs once the future is done, so `get` returns rather than waits. Whichever
            // terminal state it reports, success, failure or cancellation, belongs to the coroutine that is waiting
            // for it.
            pending.addListener(
                { continuation.resumeWith(runCatching { pending.get() }) },
                ContextCompat.getMainExecutor(context),
            )

            continuation.invokeOnCancellation { MediaController.releaseFuture(pending) }
        }

        controller.addListener(playerListener)
        _status.value = controller.toPlaybackState()

        return controller
    }

    private companion object {
        const val POSITION_SAMPLE_INTERVAL_MS = 500L
        const val MS_PER_SECOND = 1000L
    }
}

private fun Player.toPlaybackState() =
    PlaybackState(
        phase = toPlaybackPhase(),
        chunk = ChunkState(index = currentMediaItemIndex, durationMs = duration.takeIf { it != C.TIME_UNSET }),
        positionMs = currentPosition,
    )

/** The phase the player is in. */
internal fun Player.toPlaybackPhase() =
    when {
        playerError != null -> PlaybackPhase.Failed
        playbackState == Player.STATE_IDLE -> PlaybackPhase.Idle
        playbackState == Player.STATE_ENDED -> PlaybackPhase.Ended
        playbackState == Player.STATE_BUFFERING && playWhenReady -> PlaybackPhase.Buffering
        isPlaying -> PlaybackPhase.Playing
        else -> PlaybackPhase.Paused
    }
