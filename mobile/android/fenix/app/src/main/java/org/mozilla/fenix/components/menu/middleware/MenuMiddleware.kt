/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.menu.middleware

import androidx.navigation.NavController
import androidx.navigation.NavDirections
import androidx.navigation.NavOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.compose.menu.store.MenuAction
import mozilla.components.compose.menu.store.MenuAction.Init
import mozilla.components.compose.menu.store.MenuAction.Update
import mozilla.components.compose.menu.store.MenuState
import mozilla.components.compose.menu.store.MenuStore
import mozilla.components.feature.ipprotection.store.IPProtectionAction
import mozilla.components.feature.ipprotection.store.IPProtectionStore
import mozilla.components.lib.state.Middleware
import mozilla.components.lib.state.Store
import mozilla.telemetry.glean.private.NoExtras
import org.mozilla.fenix.GleanMetrics.Vpn
import org.mozilla.fenix.NavGraphDirections
import org.mozilla.fenix.R
import org.mozilla.fenix.components.AppStore
import org.mozilla.fenix.components.UseCases
import org.mozilla.fenix.components.accounts.FenixFxAEntryPoint
import org.mozilla.fenix.components.appstate.AppAction.BookmarkAction
import org.mozilla.fenix.components.appstate.AppAction.FindInPageAction
import org.mozilla.fenix.components.appstate.AppAction.ReaderViewAction
import org.mozilla.fenix.components.menu.BrowserMenuBuilder
import org.mozilla.fenix.components.menu.store.IPProtectionMenuStatus
import org.mozilla.fenix.components.menu.store.MenuAction.AddBookmark
import org.mozilla.fenix.components.menu.store.MenuAction.CustomizeReaderView
import org.mozilla.fenix.components.menu.store.MenuAction.FindInPage
import org.mozilla.fenix.components.menu.store.MenuAction.IPProtectionToggle
import org.mozilla.fenix.components.menu.store.MenuAction.Navigate
import org.mozilla.fenix.components.menu.store.MenuAction.RequestDesktopSite
import org.mozilla.fenix.components.menu.store.MenuAction.RequestMobileSite
import org.mozilla.fenix.components.menu.toMenuState
import org.mozilla.fenix.components.metrics.MetricsUtils
import org.mozilla.fenix.ext.nav

/**
 * [MenuStore] middleware handling all user interactions.
 *
 * @param appStore [AppStore] for syncing with other application features
 * @param browserStore [BrowserStore] used to read information about the current browsing status.
 * @param ipProtectionStore [IPProtectionStore] used to read the current status and to toggle IP protection.
 * @param useCases [UseCases] helping this integrate with other features of the application.
 * @param browserMenuBuilder [BrowserMenuBuilder] providing the menu to show, kept up to date.
 * @param navController [NavController] for navigating to other screens.
 * @param scope [CoroutineScope] tied to the lifetime of the menu, used for all work that is only useful while the menu
 *   is shown.
 * @param applicationScope [CoroutineScope] tied to the lifetime of the application, used for the work that cannot be
 *   interrupted and so must not be tied to the menu.
 */
@Suppress("LongParameterList")
class MenuMiddleware(
    private val appStore: AppStore,
    private val browserStore: BrowserStore,
    private val ipProtectionStore: IPProtectionStore,
    private val useCases: UseCases,
    private val browserMenuBuilder: BrowserMenuBuilder,
    private val navController: NavController,
    private val scope: CoroutineScope,
    private val applicationScope: CoroutineScope,
) : Middleware<MenuState, MenuAction> {

    override fun invoke(
        store: Store<MenuState, MenuAction>,
        next: (MenuAction) -> Unit,
        action: MenuAction,
    ) {
        when (action) {
            is Init -> observeMenuStructureUpdates(store)

            is CustomizeReaderView -> {
                dismissMenu()
                appStore.dispatch(ReaderViewAction.ReaderViewControlsShown)
            }

            is IPProtectionToggle -> handleIPProtectionToggle()

            is Navigate.IPProtectionSettings -> {
                Vpn.settingsPageTapped.record(Vpn.SettingsPageTappedExtra(entrypoint = "Menu"))
                navigateToIPProtectionSettings()
            }

            is AddBookmark -> addBookmark()

            is Navigate.EditBookmark -> {
                navigateToEditBookmark(action.guidToEdit)
            }

            is FindInPage -> {
                dismissMenu()
                appStore.dispatch(FindInPageAction.FindInPageStarted)
            }

            is RequestDesktopSite -> requestSiteMode(enableDesktopMode = true)

            is RequestMobileSite -> requestSiteMode(enableDesktopMode = false)

            is Navigate.Back -> handleBackNavigation(action)

            else -> {
                // no-op
            }
        }

        next(action)
    }

    private fun handleBackNavigation(action: Navigate.Back) {
        val tabId = browserStore.state.selectedTab?.id ?: return
        if (action.viewHistory) {
            val navOptions = NavOptions.Builder().setPopUpTo(R.id.browserFragment, false).build()
            navigate(
                NavGraphDirections.actionGlobalTabHistoryDialogFragment(activeSessionId = null),
                navOptions,
            )
        } else {
            dismissMenu()
            useCases.sessionUseCases.goBack(tabId = tabId)
        }
    }

    /** The menu is deliberately left open while connecting, so that the user can see the status change. */
    private fun handleIPProtectionToggle() {
        when (ipProtectionStore.state.toMenuState().status) {
            IPProtectionMenuStatus.Disabled -> {
                Vpn.menuTurnedOn.record()
                ipProtectionStore.dispatch(IPProtectionAction.Toggle)
            }

            IPProtectionMenuStatus.Enabled -> {
                Vpn.menuTurnedOff.record()
                ipProtectionStore.dispatch(IPProtectionAction.Toggle)
            }

            IPProtectionMenuStatus.AuthRequired -> {
                Vpn.menuTryItTapped.record(NoExtras())
                navigateToIPProtectionSettings()
            }

            IPProtectionMenuStatus.Activating,
            IPProtectionMenuStatus.DataLimitReached,
            IPProtectionMenuStatus.ConnectionError -> ipProtectionStore.dispatch(IPProtectionAction.Toggle)
        }
    }

    private fun requestSiteMode(enableDesktopMode: Boolean) {
        val tabId = browserStore.state.selectedTab?.id ?: return

        dismissMenu()
        useCases.sessionUseCases.requestDesktopSite(enable = enableDesktopMode, tabId = tabId)
    }

    private fun addBookmark() = scope.launch {
        val selectedTab = browserStore.state.selectedTab ?: return@launch
        val url = selectedTab.getTabUrl() ?: return@launch
        val title = selectedTab.content.title

        // Saving a bookmark will run until completion even if the coroutine is canceled.
        // As such we must ensure the work below does not reference any property of this middleware which could result
        // in it being leaked - together with everything it holds - while waiting for the bookmark to be saved.
        val addBookmark = useCases.bookmarksUseCases.addBookmark
        val result = applicationScope.async { addBookmark(url = url, title = title) }.await()

        appStore.dispatch(
            BookmarkAction.BookmarkAdded(
                guidToEdit = result.guidToEdit,
                parentNode = result.parentNode,
                source = MetricsUtils.BookmarkAction.Source.MENU_DIALOG,
            )
        )

        dismissMenu()
    }

    private fun navigateToEditBookmark(guidToEdit: String?) {
        if (guidToEdit == null) return

        navigate(
            NavGraphDirections.actionGlobalBookmarkEditFragment(
                guidToEdit = guidToEdit,
                requiresSnackbarPaddingForToolbar = true,
            )
        )
    }

    private fun navigateToIPProtectionSettings() {
        navigate(
            NavGraphDirections.actionGlobalIpProtectionFragment(entrypoint = FenixFxAEntryPoint.IPProtectionMainMenu)
        )
    }

    private fun observeMenuStructureUpdates(store: Store<MenuState, MenuAction>) = scope.launch {
        browserMenuBuilder.menuStructure.collect { store.dispatch(Update(it)) }
    }

    private fun navigate(directions: NavDirections, navOptions: NavOptions? = null) {
        navController.nav(R.id.menuFragment, directions, navOptions)
    }

    private fun dismissMenu() {
        navController.popBackStack(R.id.menuFragment, true)
    }
}
