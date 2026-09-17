/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.menu.middleware

import androidx.navigation.NavController
import androidx.navigation.NavDirections
import androidx.navigation.NavOptions
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.verify
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import mozilla.components.ExperimentalAndroidComponentsApi
import mozilla.components.browser.state.state.BrowserState
import mozilla.components.browser.state.state.createTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.compose.base.text.Text
import mozilla.components.compose.menu.data.MenuItem
import mozilla.components.compose.menu.data.MenuItemsGroup
import mozilla.components.compose.menu.data.StandardMenuItem
import mozilla.components.compose.menu.store.MenuState
import mozilla.components.compose.menu.store.MenuStore
import mozilla.components.concept.engine.ipprotection.ServiceState
import mozilla.components.feature.ipprotection.store.IPProtectionAction
import mozilla.components.feature.ipprotection.store.IPProtectionStore
import mozilla.components.feature.ipprotection.store.state.Authorized
import mozilla.components.feature.ipprotection.store.state.IPProtectionState
import mozilla.components.feature.ipprotection.store.state.ProxyStatus
import mozilla.components.feature.session.SessionUseCases
import mozilla.components.support.test.robolectric.testContext
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.GleanMetrics.Vpn
import org.mozilla.fenix.NavGraphDirections
import org.mozilla.fenix.R
import org.mozilla.fenix.components.AppStore
import org.mozilla.fenix.components.UseCases
import org.mozilla.fenix.components.accounts.FenixFxAEntryPoint
import org.mozilla.fenix.components.appstate.AppAction.BookmarkAction
import org.mozilla.fenix.components.appstate.AppAction.FindInPageAction
import org.mozilla.fenix.components.appstate.AppAction.ReaderViewAction
import org.mozilla.fenix.components.bookmarks.BookmarksUseCase
import org.mozilla.fenix.components.menu.BrowserMenuBuilder
import org.mozilla.fenix.components.menu.FenixMenuItem.CustomizeReaderView
import org.mozilla.fenix.components.menu.MenuItemProvider
import org.mozilla.fenix.components.menu.MenuPresentationMode.Row
import org.mozilla.fenix.components.menu.MenuSectionConfiguration
import org.mozilla.fenix.components.menu.store.MenuAction.AddBookmark
import org.mozilla.fenix.components.menu.store.MenuAction.CustomizeReaderView as CustomizeReaderViewEvent
import org.mozilla.fenix.components.menu.store.MenuAction.FindInPage
import org.mozilla.fenix.components.menu.store.MenuAction.IPProtectionToggle
import org.mozilla.fenix.components.menu.store.MenuAction.Navigate
import org.mozilla.fenix.components.menu.store.MenuAction.RequestDesktopSite
import org.mozilla.fenix.components.menu.store.MenuAction.RequestMobileSite
import org.mozilla.fenix.components.metrics.MetricsUtils
import org.mozilla.fenix.helpers.FenixGleanTestRule

@OptIn(ExperimentalAndroidComponentsApi::class)
@RunWith(AndroidJUnit4::class)
class MenuMiddlewareTest {
    @get:Rule val gleanRule = FenixGleanTestRule(testContext)

    private val appStore: AppStore = mockk { every { dispatch(any()) } just Runs }
    private val browserStore =
        BrowserStore(
            BrowserState(
                tabs = listOf(createTab(url = TEST_URL, title = TEST_TITLE, id = TAB_ID)),
                selectedTabId = TAB_ID,
            )
        )
    private val addBookmarkUseCase: BookmarksUseCase.AddBookmarksUseCase = mockk()
    private val requestDesktopSiteUseCase: SessionUseCases.RequestDesktopSiteUseCase = mockk(relaxed = true)
    private val goBackUseCase: SessionUseCases.GoBackUseCase = mockk(relaxed = true)
    private val useCases: UseCases = mockk {
        every { bookmarksUseCases } returns mockk { every { addBookmark } returns addBookmarkUseCase }
        every { sessionUseCases } returns
            mockk {
                every { requestDesktopSite } returns requestDesktopSiteUseCase
                every { goBack } returns goBackUseCase
            }
    }
    // Navigating away is guarded on still being on the menu, so the mock has to report that as the current
    // destination. A relaxed mock would otherwise report an id of 0 and every navigation would be skipped.
    private val navController: NavController =
        mockk(relaxed = true) {
            every { currentDestination } returns mockk { every { id } returns R.id.menuFragment }
        }
    private val testDispatcher = StandardTestDispatcher()

    @Test
    fun `WHEN the menu is opened THEN show the configured menu items`() =
        runTest(testDispatcher) {
            val store = createStore()

            testDispatcher.scheduler.advanceUntilIdle()

            assertEquals(
                listOf(MenuItemsGroup.Row(id = MENU_GROUP_ID, items = listOf(readerViewItem))),
                store.state.menuGroups,
            )
        }

    @Test
    fun `WHEN one of the menu items changes THEN update the menu`() =
        runTest(testDispatcher) {
            val provided = MutableStateFlow<MenuItem?>(readerViewItem)
            val store = createStore(provided)
            testDispatcher.scheduler.advanceUntilIdle()

            provided.value = null
            testDispatcher.scheduler.advanceUntilIdle()

            assertEquals(emptyList(), store.state.menuGroups)
        }

    @Test
    fun `WHEN handling starting to customize the reader view THEN dismiss the menu and show the reader view controls`() {
        val store = createStore()

        store.dispatch(CustomizeReaderViewEvent)

        verify {
            navController.popBackStack(R.id.menuFragment, true)
            appStore.dispatch(ReaderViewAction.ReaderViewControlsShown)
        }
    }

    @Test
    fun `GIVEN IP protection is off WHEN handling it being toggled THEN toggle the functionality and keep the menu open`() {
        val ipProtectionStore = ipProtectionStore(Authorized.Idle)
        val store = createStore(ipProtectionStore = ipProtectionStore)

        store.dispatch(IPProtectionToggle)

        verify { ipProtectionStore.dispatch(IPProtectionAction.Toggle) }
        verify(exactly = 0) { navController.popBackStack(any<Int>(), any()) }
        assertNotNull(Vpn.menuTurnedOn.testGetValue())
    }

    @Test
    fun `GIVEN IP protection is on WHEN handling it being toggled THEN toggle the functionality and keep the menu open`() {
        val ipProtectionStore = ipProtectionStore(Authorized.Active)
        val store = createStore(ipProtectionStore = ipProtectionStore)

        store.dispatch(IPProtectionToggle)

        verify { ipProtectionStore.dispatch(IPProtectionAction.Toggle) }
        verify(exactly = 0) { navController.popBackStack(any<Int>(), any()) }
        assertNotNull(Vpn.menuTurnedOff.testGetValue())
    }

    @Test
    fun `GIVEN authentication is needed WHEN handling it being toggled THEN open VPN settings`() {
        val ipProtectionStore = IPProtectionStore(IPProtectionState(serviceStatus = ServiceState.Unauthenticated))
        val store = createStore(ipProtectionStore = ipProtectionStore)

        store.dispatch(IPProtectionToggle)

        verify {
            navController.navigate(
                NavGraphDirections.actionGlobalIpProtectionFragment(
                    entrypoint = FenixFxAEntryPoint.IPProtectionMainMenu
                ),
                null,
            )
        }
        assertNotNull(Vpn.menuTryItTapped.testGetValue())
    }

    @Test
    fun `WHEN handling a navigation to the IP protection settings THEN open the VPN settings`() {
        val store = createStore()

        store.dispatch(Navigate.IPProtectionSettings)

        verify {
            navController.navigate(
                NavGraphDirections.actionGlobalIpProtectionFragment(
                    entrypoint = FenixFxAEntryPoint.IPProtectionMainMenu
                ),
                null,
            )
        }
        assertEquals("Menu", Vpn.settingsPageTapped.testGetValue()?.last()?.extra?.get("entrypoint"))
    }

    @Test
    fun `WHEN handling adding a bookmark THEN bookmark the current page and dismiss the menu`() =
        runTest(testDispatcher) {
            coEvery { addBookmarkUseCase(url = TEST_URL, title = TEST_TITLE) } returns
                BookmarksUseCase.AddBookmarksUseCase.Result(guidToEdit = BOOKMARK_GUID, parentNode = null)
            val store = createStore()

            store.dispatch(AddBookmark)
            testDispatcher.scheduler.advanceUntilIdle()

            verify {
                appStore.dispatch(
                    BookmarkAction.BookmarkAdded(
                        guidToEdit = BOOKMARK_GUID,
                        parentNode = null,
                        source = MetricsUtils.BookmarkAction.Source.MENU_DIALOG,
                    )
                )
                navController.popBackStack(R.id.menuFragment, true)
            }
        }

    @Test
    fun `GIVEN the current page is bookmarked WHEN handling EditBookmark THEN open the bookmarks editor`() {
        val store = createStore()

        store.dispatch(Navigate.EditBookmark(guidToEdit = BOOKMARK_GUID))

        verify {
            navController.navigate(
                NavGraphDirections.actionGlobalBookmarkEditFragment(
                    guidToEdit = BOOKMARK_GUID,
                    requiresSnackbarPaddingForToolbar = true,
                ),
                null,
            )
        }
    }

    @Test
    fun `GIVEN the current page is not bookmarked WHEN handling EditBookmark THEN don't open the editor`() {
        val store = createStore()

        store.dispatch(Navigate.EditBookmark(guidToEdit = null))

        verify(exactly = 0) { navController.navigate(any<NavDirections>(), any<NavOptions>()) }
    }

    @Test
    fun `WHEN handling the find in page feature being started THEN dismiss the menu and start searching in the current page`() {
        val store = createStore()

        store.dispatch(FindInPage)

        verify {
            navController.popBackStack(R.id.menuFragment, true)
            appStore.dispatch(FindInPageAction.FindInPageStarted)
        }
    }

    @Test
    fun `GIVEN in mobile mode WHEN handling desktop site being requested THEN dismiss the menu and load the desktop version of the current page`() {
        val store = createStore()

        store.dispatch(RequestDesktopSite)

        verify {
            navController.popBackStack(R.id.menuFragment, true)
            requestDesktopSiteUseCase(enable = true, tabId = TAB_ID)
        }
    }

    @Test
    fun `GIVEN in desktop mode WHEN handling mobile mode being requested THEN dismiss the menu and load the mobile version of the current page`() {
        val store = createStore()

        store.dispatch(RequestMobileSite)

        verify {
            navController.popBackStack(R.id.menuFragment, true)
            requestDesktopSiteUseCase(enable = false, tabId = TAB_ID)
        }
    }

    @Test
    fun `WHEN handling back navigation THEN dismiss the menu and navigate back in the current tab`() {
        val store = createStore()

        store.dispatch(Navigate.Back(viewHistory = false))

        verify {
            navController.popBackStack(R.id.menuFragment, true)
            goBackUseCase(tabId = TAB_ID)
        }
    }

    @Test
    fun `WHEN handling back navigation with history THEN dismiss the menu and show the tab history`() {
        val store = createStore()

        store.dispatch(Navigate.Back(viewHistory = true))

        verify {
            navController.navigate(
                NavGraphDirections.actionGlobalTabHistoryDialogFragment(activeSessionId = null),
                any<NavOptions>(),
            )
        }
    }

    @Test
    fun `GIVEN there is no selected tab WHEN handling back navigation THEN do nothing`() {
        val emptyBrowserStore = BrowserStore(BrowserState(tabs = emptyList()))
        val store = createStore(browserStore = emptyBrowserStore)

        store.dispatch(Navigate.Back(viewHistory = false))

        verify(exactly = 0) {
            navController.popBackStack(R.id.menuFragment, true)
            goBackUseCase(any())
        }
    }

    private fun ipProtectionStore(proxyStatus: ProxyStatus): IPProtectionStore = mockk {
        every { state } returns IPProtectionState(proxyStatus = proxyStatus)
        every { dispatch(any()) } just Runs
    }

    private fun createStore(
        provided: StateFlow<MenuItem?> = MutableStateFlow(readerViewItem),
        ipProtectionStore: IPProtectionStore = ipProtectionStore(Authorized.Idle),
        browserStore: BrowserStore = this.browserStore,
    ) =
        MenuStore(
            initialState = MenuState(emptyList()),
            middleware =
                listOf(
                    MenuMiddleware(
                        appStore = appStore,
                        browserStore = browserStore,
                        ipProtectionStore = ipProtectionStore,
                        useCases = useCases,
                        browserMenuBuilder =
                            BrowserMenuBuilder(
                                providers = mapOf(CustomizeReaderView to FakeMenuItemProvider(provided)),
                                configuration =
                                    listOf(
                                        MenuSectionConfiguration(
                                            id = MENU_GROUP_ID,
                                            presentationMode = Row,
                                            items = listOf(CustomizeReaderView),
                                        )
                                    ),
                            ),
                        navController = navController,
                        scope = CoroutineScope(testDispatcher),
                        applicationScope = CoroutineScope(testDispatcher),
                    )
                ),
        )

    private class FakeMenuItemProvider(override val itemFlow: StateFlow<MenuItem?>) : MenuItemProvider

    private companion object {
        const val MENU_GROUP_ID = "test"
        const val BOOKMARK_GUID = "bookmarkGuid"
        const val TEST_URL = "https://mozilla.org"
        const val TEST_TITLE = "Mozilla"
        const val TAB_ID = "tab1"

        val readerViewItem =
            StandardMenuItem(title = Text.String("Customize reader view"), onClickEvent = CustomizeReaderViewEvent)
    }
}
