/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.listentopage

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.ComposeView
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mozilla.components.feature.listentopage.ListenState
import mozilla.components.feature.listentopage.ListenStore
import mozilla.components.feature.listentopage.ui.ListenSheet
import mozilla.components.support.base.feature.LifecycleAwareFeature
import org.mozilla.fenix.R
import org.mozilla.fenix.theme.FirefoxTheme

private val ListenState.isArticleReady: Boolean
    get() = tabId != null && languageTag != null

/**
 * This integration is responsible for adding or removing Listen to page media player and properly anchoring it to the
 * browser.
 */
class ListenSheetIntegration(
    private val container: CoordinatorLayout,
    private val listenStore: ListenStore,
    private val isAddressBarAtBottom: Boolean,
) : LifecycleAwareFeature {

    private var listenPlayer: ComposeView? = null

    override fun start() {
        if (listenPlayer != null) return
        val view =
            ComposeView(container.context).apply {
                id = R.id.listenSheet
                layoutParams =
                    CoordinatorLayout.LayoutParams(
                            CoordinatorLayout.LayoutParams.MATCH_PARENT,
                            CoordinatorLayout.LayoutParams.WRAP_CONTENT,
                        )
                        .apply { behavior = ListenSheetBehavior(isAddressBarAtBottom = isAddressBarAtBottom) }
                setContent { ListenSheetHost(listenStore) }
            }
        listenPlayer = view

        container.post {
            if (listenPlayer === view) {
                container.addView(view)
            }
        }
    }

    override fun stop() {
        container.removeView(listenPlayer)
        listenPlayer = null
    }

    @Composable
    private fun ListenSheetHost(listenStore: ListenStore) {
        FirefoxTheme {
            ListenSheetContent(listenStore)
        }
    }
}

/** Shows media player controls for Listen To Page feature */
@Composable
fun ListenSheetContent(listenStore: ListenStore) {
    val state = listenStore.stateFlow.collectAsStateWithLifecycle()
    if (state.value.isArticleReady) {
        ListenSheet()
    }
}
